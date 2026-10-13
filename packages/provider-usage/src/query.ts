// Endpoints and request sequences adapted from pi-provider-usage/src/query.ts.
// Authentication is a fixed configuration snapshot, not a live Pi runtime grant.
import { createFireworksAdapter } from "./providers/fireworks.js";
import { normalizeBasetenBillingUsagePayload } from "./providers/baseten.js";
import { normalizeCodexBackendPayload } from "./providers/codex.js";
import { normalizeDeepSeekBalancePayload } from "./providers/deepseek.js";
import { normalizeGitHubCopilotUsagePayload } from "./providers/github-copilot.js";
import { normalizeKimiCodingUsagePayload } from "./providers/kimi-coding.js";
import { miniMaxUsageKind, normalizeMiniMaxUsagePayload } from "./providers/minimax.js";
import { normalizeMoonshotBalancePayload } from "./providers/moonshot.js";
import { normalizeOpenCodeZenPayload } from "./providers/opencode-zen.js";
import { normalizeOpenRouterKeyPayload } from "./providers/openrouter.js";
import { normalizeVercelAIGatewayCreditsPayload } from "./providers/vercel-ai-gateway.js";
import { normalizeXaiBillingPayload } from "./providers/xai.js";
import { normalizeZaiQuotaPayload, normalizeZaiSubscriptionPayload } from "./providers/zai.js";
import { zaiResponseError } from "./providers/zai-errors.js";
import { resolveProviderCredentials } from "./configuration.js";
import { abortError, createUsageHttpTransport, UsageRequestError, type UsageHttpTransport } from "./http.js";
import { redactWithSecrets } from "./masking.js";
import { providerDefinition, PROVIDER_USAGE_DEFINITIONS } from "./providerDefinitions.js";
import type { UsageReport } from "./providerTypes.js";
import type { QueryUsageOptions, ProviderUsageResult, ReadyProviderCredential } from "./types.js";

const PROVIDER_TIMEOUT_MS = 15_000;
const ALL_CONCURRENCY = 2;

export async function queryUsage(
  scope: string,
  input: QueryUsageOptions,
  signal: AbortSignal = new AbortController().signal,
): Promise<readonly ProviderUsageResult[]> {
  if (scope !== "all" && !providerDefinition(scope)) throw new Error("Unsupported usage provider.");
  if (signal.aborted) throw abortError();
  const credentials = await resolveProviderCredentials(input);
  if (signal.aborted) throw abortError();
  const selected = credentials.filter((item) => scope === "all" ? item.source !== "not-configured" : item.providerId === scope);
  const results = new Array<ProviderUsageResult>(selected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(ALL_CONCURRENCY, selected.length) }, async () => {
    while (next < selected.length) {
      if (signal.aborted) throw abortError();
      const index = next++;
      const credential = selected[index]!;
      results[index] = credential.status === "unavailable"
        ? { providerId: credential.providerId, status: "unavailable", source: credential.source, reason: credential.reason }
        : await queryResolvedCredential(credential, input, signal);
    }
  }));
  if (signal.aborted) throw abortError();
  return results;
}

async function queryResolvedCredential(
  credential: ReadyProviderCredential,
  input: QueryUsageOptions,
  callerSignal: AbortSignal,
): Promise<ProviderUsageResult> {
  const controller = new AbortController();
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let transport: UsageHttpTransport | undefined;
  try {
    const reportOperation = credential.providerId === "openai"
      ? Promise.resolve(nativeChatGPTReport())
      : (() => {
          transport = createUsageHttpTransport(credential.providerId, input.environment ?? process.env, input.fetch);
          return requestUsage(credential, transport, signal);
        })();
    const outcome = await waitForOperation(reportOperation, signal);
    if (signal.aborted) throw abortError();
    if ("status" in outcome) return { ...outcome, source: credential.source };
    const secrets = [...credential.secrets, credential.authorization, ...PROVIDER_USAGE_DEFINITIONS.flatMap((item) => item.envVarNames)];
    return { providerId: credential.providerId, status: "ready", source: credential.source, report: sanitizeReport(outcome, secrets) };
  } catch (error) {
    if (callerSignal.aborted) throw abortError();
    return {
      providerId: credential.providerId,
      status: "query-failed",
      source: credential.source,
      reason: controller.signal.aborted ? "Provider usage query timed out after 15 seconds."
        : error instanceof UsageRequestError ? error.message : "Provider returned invalid or unsupported usage data.",
    };
  } finally {
    clearTimeout(timeout);
    await transport?.close();
  }
}

type AccountSelectionRequired = { providerId: string; status: "selection-required"; reason: string };

async function requestUsage(
  credential: ReadyProviderCredential,
  transport: UsageHttpTransport,
  signal: AbortSignal,
): Promise<UsageReport | AccountSelectionRequired> {
  const id = credential.providerId;
  const definition = providerDefinition(id)!;
  const headers = { Authorization: credential.authorization, ...credential.extraHeaders };
  const json = (url = definition.usageEndpoint, override = headers) => transport.json(url, override, signal);
  const capturedAt = () => Date.now();
  switch (id) {
    case "baseten": {
      const url = new URL(definition.usageEndpoint);
      const end = Date.now();
      url.searchParams.set("start_date", new Date(end - 30 * 24 * 60 * 60 * 1_000).toISOString());
      url.searchParams.set("end_date", new Date(end).toISOString());
      return normalizeBasetenBillingUsagePayload(await json(url.toString()), capturedAt());
    }
    case "openai-codex": return normalizeCodexBackendPayload(await json(), capturedAt());
    case "deepseek": return normalizeDeepSeekBalancePayload(await json(), capturedAt());
    case "github-copilot": return normalizeGitHubCopilotUsagePayload(await json(), capturedAt());
    case "openrouter": return normalizeOpenRouterKeyPayload(await json(), capturedAt());
    case "vercel-ai-gateway": return normalizeVercelAIGatewayCreditsPayload(await json(), capturedAt());
    case "opencode-go": return normalizeOpenCodeZenPayload(await json(), capturedAt());
    case "kimi-coding": return normalizeKimiCodingUsagePayload(await json(), capturedAt());
    case "minimax":
    case "minimax-cn": {
      const token = /^Bearer\s+(.+)$/iu.exec(credential.authorization)?.[1];
      if (!token) throw new UsageRequestError("MiniMax usage requires a Bearer credential.");
      const kind = miniMaxUsageKind(token);
      const path = kind === "account-balance" ? "/account/query_balance" : "/v1/token_plan/remains";
      return normalizeMiniMaxUsagePayload(id, kind, await json(`${definition.clientOrigins[0]}${path}`), capturedAt());
    }
    case "moonshotai":
    case "moonshotai-cn": return normalizeMoonshotBalancePayload(id, await json(), capturedAt());
    case "fireworks": {
      const auth = { headers };
      // The source adapter's guard is cancellation-only here: credentials belong
      // to this request snapshot, not a mutable runtime account selection.
      const guard = () => { if (signal.aborted) throw abortError(); return Promise.resolve(); };
      const adapter = createFireworksAdapter((url, requestAuth) => transport.json(url, requestAuth.headers, signal));
      const targets = await adapter.targets!.list(auth, signal, PROVIDER_TIMEOUT_MS, guard);
      if (!targets.length) throw new UsageRequestError("Fireworks billing account discovery returned no accounts.");
      if (targets.length > 1_000) throw new UsageRequestError("Fireworks billing account discovery exceeded the limit.");
      if (targets.length !== 1) return { providerId: id, status: "selection-required", reason: "Multiple Fireworks billing accounts are available. Account selection is not supported." };
      return adapter.query(auth, signal, PROVIDER_TIMEOUT_MS, guard, targets[0]!.id);
    }
    case "xai": {
      const clientHeaders = { ...headers, "X-XAI-Token-Auth": "xai-grok-cli", "x-grok-client-version": "1.0.10", "x-grok-client-mode": "interactive" };
      const user = await transport.json(definition.usageEndpoint, clientHeaders, signal, { userAgent: false });
      if (typeof user.userId !== "string" || !/^[A-Za-z0-9._~-]{1,128}$/u.test(user.userId)) {
        throw new UsageRequestError("xAI returned an invalid account identifier.");
      }
      const billing = await transport.json("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { ...clientHeaders, "x-userid": user.userId }, signal, { userAgent: false });
      return normalizeXaiBillingPayload(billing, user.subscriptionTier, capturedAt());
    }
    case "zai":
    case "zai-coding-cn": {
      // The source monitor accepts the key without the Bearer prefix.
      const monitorHeaders = { ...headers, Authorization: credential.authorization.replace(/^Bearer\s+/iu, "") };
      const payload = await transport.json(definition.usageEndpoint, monitorHeaders, signal, { responseError: zaiResponseError });
      let plan;
      try {
        const subscription = await transport.json(`${definition.clientOrigins[0]}/api/biz/subscription/list`, monitorHeaders, signal, { responseError: zaiResponseError });
        plan = normalizeZaiSubscriptionPayload(subscription);
      } catch {
        if (signal.aborted) throw abortError();
        // Source contract: optional plan metadata must not hide valid quota data.
      }
      return normalizeZaiQuotaPayload(id, definition.displayName, payload, capturedAt(), plan);
    }
    default: throw new UsageRequestError("Usage querying is unsupported for this provider.");
  }
}

function nativeChatGPTReport(): UsageReport {
  return {
    providerId: "openai", providerName: "OpenAI", capturedAt: Date.now(), source: "openai-chatgpt-auth",
    semantics: { kind: "consumer-subscription", label: "ChatGPT plan authentication status" },
    buckets: [], metrics: [{ id: "plan-auth", label: "ChatGPT plan authentication", value: "Connected (native OAuth)" }],
    notes: ["Numerical usage and reset times are unavailable for native OpenAI OAuth.", "Manage usage: https://chatgpt.com/settings/usage"],
  };
}

/** Caller cancellation also bounds injected transports that do not observe abort. */
function waitForOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) {
      void operation.catch(() => undefined);
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error instanceof Error ? error : new Error("Provider query failed.")); },
    );
  });
}

/** Provider-supplied labels/notes are data, not a channel for echoed credentials. */
function sanitizeReport(report: UsageReport, secrets: readonly string[]): UsageReport {
  const safe = (value: string) => redactWithSecrets(value, secrets);
  return {
    ...report,
    providerName: safe(report.providerName),
    source: safe(report.source),
    semantics: { ...report.semantics, label: safe(report.semantics.label) },
    ...(report.accountLabel ? { accountLabel: safe(report.accountLabel) } : {}),
    buckets: report.buckets.map((bucket) => ({ ...bucket, id: safe(bucket.id), label: safe(bucket.label),
      ...(bucket.groupId ? { groupId: safe(bucket.groupId) } : {}), ...(bucket.groupLabel ? { groupLabel: safe(bucket.groupLabel) } : {}),
      ...(bucket.modelKeys ? { modelKeys: bucket.modelKeys.map(safe) } : {}), ...(bucket.period ? { period: safe(bucket.period) } : {}) })),
    metrics: report.metrics.map((metric) => ({ ...metric, id: safe(metric.id), label: safe(metric.label),
      value: typeof metric.value === "string" ? safe(metric.value) : metric.value })),
    ...(report.notes ? { notes: report.notes.map(safe) } : {}),
  };
}
