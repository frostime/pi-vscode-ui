import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { queryUsage } from "../src/query.js";
import type { UsageFetch } from "../src/http.js";
import { createTemporaryAgentDir, type TempAgentDir } from "./support.js";

let directory: TempAgentDir | undefined;
function disposeDirectory() { directory?.dispose(); directory = undefined; }
afterEach(() => { vi.useRealTimers(); disposeDirectory(); });
const secret = "synthetic-usage-secret-only";
const refresh = "synthetic-usage-refresh-only";
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
function auth(providerId: string, oauth = false, token = secret) {
  directory = createTemporaryAgentDir();
  directory.writeAuthJson(JSON.stringify({ [providerId]: oauth
    ? { type: "oauth", access: token, refresh, expires: 0, clientId: "synthetic-client", scopes: ["chatgpt.tokens.use.direct"] }
    : { type: "api_key", key: token } }));
  return { agentDirectory: directory.root, environment: {} };
}

// Payloads are extracted from named helpers/tests in the pinned source project,
// or copied unchanged from its sanitized fixtures. These are not guessed schemas.
const cases = [
  ["baseten", "baseten", false, "https://api.baseten.co/v1/billing/usage_summary"],
  ["openai-codex", "codex", true, "https://chatgpt.com/backend-api/wham/usage"],
  ["deepseek", "deepseek", false, "https://api.deepseek.com/user/balance"],
  ["github-copilot", "copilot", true, "https://api.github.com/copilot_internal/user"],
  ["openrouter", "openrouter", false, "https://openrouter.ai/api/v1/key"],
  ["vercel-ai-gateway", "vercel", false, "https://ai-gateway.vercel.sh/v1/credits"],
  ["opencode-go", "opencode", false, "https://opencode.ai/zen/go/v1/usage"],
  ["kimi-coding", "kimi-coding-weekly", false, "https://api.kimi.com/coding/v1/usages"],
  ["minimax", "minimax-quota", false, "https://api.minimax.io/v1/token_plan/remains"],
  ["minimax-cn", "minimax-quota", false, "https://api.minimaxi.com/v1/token_plan/remains"],
  ["moonshotai", "moonshot", false, "https://api.moonshot.ai/v1/users/me/balance"],
  ["moonshotai-cn", "moonshot", false, "https://api.moonshot.cn/v1/users/me/balance"],
] as const;
for (const [id, payload, oauth, endpoint] of cases) {
  test(`queries ${id} using its source-defined request and report`, async () => {
    const input = auth(id, oauth);
    const requests: string[] = [];
    const fetch: UsageFetch = (url, options) => {
      requests.push(url);
      expect(options.headers.Authorization === `Bearer ${id === "github-copilot" ? refresh : secret}`).toBe(true);
      expect(options.redirect === "error").toBe(true);
      return Promise.resolve(Response.json(fixture(payload)));
    };
    const result = (await queryUsage(id, { ...input, fetch }))[0];
    expect(result?.status).toBe("ready");
    expect(requests.length).toBe(1);
    expect(requests[0]?.startsWith(endpoint)).toBe(true);
    expect(JSON.stringify(result).includes(secret) || JSON.stringify(result).includes(refresh)).toBe(false);
    if (id === "openai-codex" && result?.status === "ready") {
      expect(result.report.metrics.find((item) => item.id === "reset-credits")?.value).toBe(2);
      expect(result.report.buckets.length).toBe(3);
    }
    if (id === "baseten") {
      const url = new URL(requests[0]!);
      expect(Date.parse(url.searchParams.get("end_date")!) - Date.parse(url.searchParams.get("start_date")!)).toBe(30 * 24 * 60 * 60 * 1_000);
    }
  });
}

test("MiniMax account keys select the balance endpoint without probing quota", async () => {
  const token = "sk-api-synthetic-balance-secret";
  const urls: string[] = [];
  const result = await queryUsage("minimax", { ...auth("minimax", false, token), fetch: (url) => {
    urls.push(url); return Promise.resolve(Response.json(fixture("minimax-balance")));
  } });
  expect(result[0]?.status).toBe("ready");
  expect(urls).toEqual(["https://api.minimax.io/account/query_balance"]);
});

for (const id of ["zai", "zai-coding-cn"] as const) {
  test(`${id} uses raw-key monitoring and keeps quota if optional plan lookup fails`, async () => {
    const origin = id === "zai" ? "https://api.z.ai" : "https://open.bigmodel.cn";
    const urls: string[] = [];
    const result = await queryUsage(id, { ...auth(id), fetch: (url, options) => {
      expect(options.headers.Authorization === secret).toBe(true);
      urls.push(url); return Promise.resolve(url.endsWith("/list") ? new Response("unavailable", { status: 404 }) : Response.json(fixture("zai-quota")));
    } });
    expect(urls).toEqual([`${origin}/api/monitor/usage/quota/limit`, `${origin}/api/biz/subscription/list`]);
    expect(result[0]?.status).toBe("ready");
    if (result[0]?.status === "ready") expect(result[0].report.buckets.length).toBe(3);
  });
}

test("xAI binds its validated identity only to the second request", async () => {
  const options = auth("xai", true);
  const user = fixture("xai/user-current");
  let request = 0;
  const result = await queryUsage("xai", { ...options, fetch: (url, init) => {
    request++;
    expect(init.headers["User-Agent"] === undefined).toBe(true);
    expect(init.headers["X-XAI-Token-Auth"] === "xai-grok-cli").toBe(true);
    expect(request === 1 ? init.headers["x-userid"] === undefined : init.headers["x-userid"] === user.userId).toBe(true);
    expect(url === (request === 1 ? "https://cli-chat-proxy.grok.com/v1/user?include=subscription" : "https://cli-chat-proxy.grok.com/v1/billing?format=credits")).toBe(true);
    return Promise.resolve(Response.json(request === 1 ? user : fixture("xai/billing-current")));
  } });
  expect(result[0]?.status).toBe("ready");
  expect(request).toBe(2);
});

test("Fireworks queries the sole account but never chooses among multiple accounts", async () => {
  const input = auth("fireworks");
  let calls = 0;
  const fetch: UsageFetch = (url) => {
    calls++; return Promise.resolve(Response.json(url.includes("billing") ? fixture("fireworks") : { accounts: [{ name: "accounts/test-account" }] }));
  };
  expect((await queryUsage("fireworks", { ...input, fetch }))[0]?.status).toBe("ready");
  expect(calls).toBe(2);
  calls = 0;
  const multiple = await queryUsage("fireworks", { ...input, fetch: () => {
    calls++; return Promise.resolve(Response.json({ accounts: [{ name: "accounts/one" }, { name: "accounts/two" }] }));
  } });
  expect(multiple[0]?.status).toBe("selection-required");
  expect(calls).toBe(1);
});

test("native ChatGPT returns its limited local status without a usage HTTP request", async () => {
  const result = await queryUsage("openai", { ...auth("openai", true), fetch: () => { throw new Error("unexpected request"); } });
  expect(result[0]?.status).toBe("ready");
  if (result[0]?.status === "ready") expect(result[0].report.buckets).toEqual([]);
});

test("Copilot API keys and mismatched subscription headers fail before HTTP", async () => {
  let calls = 0;
  const fetch: UsageFetch = () => { calls++; return Promise.resolve(Response.json({})); };
  expect((await queryUsage("github-copilot", { ...auth("github-copilot"), fetch }))[0]?.status).toBe("unavailable");
  disposeDirectory();
  for (const id of ["github-copilot", "xai"]) {
    const input = auth(id, true);
    directory!.writeModelsJson(JSON.stringify({ providers: { [id]: { headers: { Authorization: "Bearer synthetic-different-account" } } } }));
    expect((await queryUsage(id, { ...input, fetch }))[0]?.status).toBe("unavailable");
    disposeDirectory();
  }
  expect(calls).toBe(0);
});

test("ambiguous authorization headers do not choose a saved subscription credential", async () => {
  const input = auth("openai", true);
  directory!.writeModelsJson(JSON.stringify({ providers: { openai: { headers: { Authorization: `Bearer ${secret}`, authorization: "Bearer synthetic-other-account" } } } }));
  const result = await queryUsage("openai", { ...input, fetch: () => { throw new Error("unexpected request"); } });
  expect(result[0]?.status).toBe("unavailable");
});

test("incomplete OAuth access is unavailable without probing a provider", async () => {
  const input = auth("openai-codex", true, "");
  let calls = 0;
  const result = await queryUsage("openai-codex", { ...input, fetch: () => { calls++; return Promise.resolve(Response.json({})); } });
  expect(result[0]?.status).toBe("unavailable");
  expect(calls).toBe(0);
});

test("all bounds concurrency and retains independent failures", async () => {
  directory = createTemporaryAgentDir();
  directory.writeAuthJson(JSON.stringify(Object.fromEntries(["baseten", "deepseek", "openrouter"].map((id) => [id, { type: "api_key", key: secret }]))));
  let active = 0, maximum = 0;
  const result = await queryUsage("all", { agentDirectory: directory.root, environment: {}, fetch: async (url) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return url.includes("deepseek") ? new Response("denied", { status: 401 }) : Response.json(fixture(url.includes("baseten") ? "baseten" : "openrouter"));
  } });
  expect(maximum).toBe(2);
  expect(result.map((item) => item.status)).toEqual(["ready", "query-failed", "ready"]);
});

test("caller cancellation stops a query without waiting for a stalled injected transport", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const pending = queryUsage("deepseek", { ...auth("deepseek"), fetch: () => { started(); return new Promise<never>(() => {}); } }, controller.signal);
  const cancelled = pending.catch((error: unknown) => error instanceof Error && error.name === "AbortError");
  await start; controller.abort();
  expect(await cancelled).toBe(true);
});

test("the full provider deadline stops a stalled request", async () => {
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const pending = queryUsage("deepseek", { ...auth("deepseek"), fetch: () => { started(); return new Promise<never>(() => {}); } });
  vi.useFakeTimers();
  await start;
  await vi.advanceTimersByTimeAsync(15_000);
  const result = await pending;
  expect(result[0]?.status).toBe("query-failed");
  expect(result[0]?.status !== "ready" && result[0]?.reason.includes("timed out")).toBe(true);
});

test("public results and errors do not retain echoed credentials", async () => {
  const input = auth("openrouter");
  const payload = fixture("openrouter");
  const echoed = { ...payload, data: { ...(payload.data as Record<string, unknown>), label: secret } };
  const good = await queryUsage("openrouter", { ...input, fetch: () => Promise.resolve(Response.json(echoed)) });
  expect(JSON.stringify(good).includes(secret)).toBe(false);
  const bad = await queryUsage("openrouter", { ...input, fetch: () => Promise.resolve(new Response(secret, { status: 401 })) });
  expect(bad[0]?.status).toBe("query-failed");
  expect(JSON.stringify(bad).includes(secret)).toBe(false);
});
