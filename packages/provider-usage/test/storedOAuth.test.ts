import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProviderCredentials } from "../src/configuration.js";
import { bearerEquals, createTemporaryAgentDir, type TempAgentDir } from "./support.js";

/**
 * Provider-specific stored-OAuth interpretation, without refresh.
 * Expected outcomes come from the source snapshot's provider rules
 * (`openai-chatgpt.ts`, Copilot refresh interpretation, Pi `toAuth`
 * derivations for codex/openrouter/xai/kimi).
 */
describe("stored OAuth credential interpretation (no refresh)", () => {
  let fixture!: TempAgentDir;
  beforeEach(() => {
    fixture = createTemporaryAgentDir();
  });
  afterEach(() => {
    fixture.dispose();
  });
  const input = () => ({
    authPath: fixture.authPath,
    modelsJsonPath: fixture.modelsPath,
    environment: fakeEnvironment(),
  });
  function fakeEnvironment(): Record<string, string | undefined> {
    return {};
  }
  const farFutureExpires = Date.now() + 60 * 60 * 1000;

  it("uses the native ChatGPT grant for OpenAI plan-status credentials", async () => {
    fixture = createTemporaryAgentDir();
    const access = "native-chatgpt-access-token-fake";
    const refresh = "native-chatgpt-refresh-token-fake";
    fixture.writeAuthJson(JSON.stringify({
      openai: { type: "oauth", access, refresh, expires: farFutureExpires, clientId: "fake-client-id", scopes: ["chatgpt.tokens.use.direct"] },
    }));
    const openai = (await resolveProviderCredentials(input())).find((o) => o.providerId === "openai");
    expect(openai?.status).toBe("ready");
    expect(openai?.source).toBe("auth.json");
    expect(bearerEquals(openai?.status === "ready" ? openai.authorization : undefined, access)).toBe(true);
    // Refresh tokens stay redaction-pool members, not output.
    expect(openai?.status === "ready" ? openai.secrets.includes(refresh) : false).toBe(true);
  });

  it("rejects an incomplete native ChatGPT grant instead of guessing", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      openai: { type: "oauth", access: "access-token-fake", refresh: "refresh-token-fake", expires: farFutureExpires, clientId: "fake-client-id", scopes: ["other.scope"] },
    }));
    const openai = (await resolveProviderCredentials(input())).find((o) => o.providerId === "openai");
    expect(openai?.status).toBe("unavailable");
    expect(openai?.status === "unavailable" ? /native ChatGPT grant/.test(openai.reason) : false).toBe(true);
  });

  it("uses the GitHub token (refresh field) as the Copilot usage bearer with the pinned API version", async () => {
    fixture = createTemporaryAgentDir();
    const githubToken = "copilot-github-token-fake";
    const proxyToken = "copilot-proxy-token-fake";
    fixture.writeAuthJson(JSON.stringify({
      "github-copilot": { type: "oauth", access: proxyToken, refresh: githubToken, expires: farFutureExpires },
    }));
    const copilot = (await resolveProviderCredentials(input())).find((o) => o.providerId === "github-copilot");
    expect(copilot?.status).toBe("ready");
    if (copilot?.status !== "ready") return;
    expect(bearerEquals(copilot.authorization, githubToken)).toBe(true);
    // Short-lived proxy access token is NOT the usage credential.
    expect(copilot.authorization.includes(proxyToken)).toBe(false);
    expect(copilot.extraHeaders?.["X-GitHub-Api-Version"]).toBe("2025-05-01");
  });

  it("accepts a stored public GitHub account enterpriseUrl (github.com classification only)", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      "github-copilot": {
        type: "oauth",
        access: "access-token-fake",
        refresh: "refresh-token-fake",
        expires: farFutureExpires,
        enterpriseUrl: "https://github.com",
      },
    }));
    const copilot = (await resolveProviderCredentials(input())).find((o) => o.providerId === "github-copilot");
    expect(copilot?.status).toBe("ready");
    expect(bearerEquals(copilot?.status === "ready" ? copilot.authorization : undefined, "refresh-token-fake")).toBe(true);
  });

  it("accepts the source endpoint pattern https://api.<region>.githubcopilot.com as a client origin", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeModelsJson(JSON.stringify({
      providers: { "github-copilot": { baseUrl: "https://api.business.githubcopilot.com" } },
    }));
    const copilot = (await resolveProviderCredentials(input())).find((o) => o.providerId === "github-copilot");
    // No credential source at all: the client endpoint is capacity-eligible.
    expect(copilot?.source).toBe("not-configured");
  });

  it("rejects github.com as a models.json client endpoint for Copilot (classification is not an endpoint)", async () => {
    fixture = createTemporaryAgentDir();
    const githubToken = "copilot-github-token-fake";
    fixture.writeAuthJson(JSON.stringify({
      "github-copilot": {
        type: "oauth",
        access: "access-token-fake",
        refresh: githubToken,
        expires: farFutureExpires,
        enterpriseUrl: "https://github.com",
      },
    }));
    fixture.writeModelsJson(JSON.stringify({
      providers: { "github-copilot": { baseUrl: "https://github.com" } },
    }));
    const copilot = (await resolveProviderCredentials(input())).find((o) => o.providerId === "github-copilot");
    expect(copilot?.status).toBe("unavailable");
    expect(reasonContains(copilot, "official origin")).toBe(true);
    // The stored public classification did not leak any credential.
    expect(bearerOf(copilot)).toBeUndefined();
  });

  it("rejects GitHub Enterprise Copilot credentials (source rule)", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      "github-copilot": {
        type: "oauth",
        access: "access-token-fake",
        refresh: "refresh-token-fake",
        expires: farFutureExpires,
        enterpriseUrl: "github.copilot.corp.example",
      },
    }));
    const copilot = (await resolveProviderCredentials(input())).find((o) => o.providerId === "github-copilot");
    expect(copilot?.status).toBe("unavailable");
    expect(copilot?.status === "unavailable" ? /Enterprise/.test(copilot.reason) : false).toBe(true);
  });

  it("uses the stored access token for codex, openrouter, xAI and Kimi bearer interpretation", async () => {
    fixture = createTemporaryAgentDir();
    const codex = "codex-access-token-fake";
    const openrouter = "openrouter-access-token-fake";
    const xai = "xai-access-token-fake";
    const kimi = "kimi-access-token-fake";
    fixture.writeAuthJson(JSON.stringify({
      "openai-codex": { type: "oauth", access: codex, refresh: "codex-refresh-fake", expires: farFutureExpires },
      openrouter: { type: "oauth", access: openrouter, refresh: "", expires: rangeSafeFuture() },
      xai: { type: "oauth", access: xai, refresh: "xai-refresh-fake", expires: farFutureExpires },
      "kimi-coding": { type: "oauth", access: kimi, refresh: "kimi-refresh-fake", expires: farFutureExpires },
    }));
    function rangeSafeFuture(): number {
      return Number.MAX_SAFE_INTEGER;
    }
    const outcomes = await resolveProviderCredentials(input());
    const expected: Array<[string, string]> = [
      ["openai-codex", codex],
      ["openrouter", openrouter],
      ["xai", xai],
      ["kimi-coding", kimi],
    ];
    for (const [providerId, token] of expected) {
      const outcome = outcomes.find((o) => o.providerId === providerId);
      expect(outcome?.status).toBe("ready");
      expect(bearerEquals(outcome?.status === "ready" ? outcome.authorization : undefined, token)).toBe(true);
    }
  });

  it("does not hide valid-shaped saved credentials behind expired token metadata (no local-clock gate)", async () => {
    fixture = createTemporaryAgentDir();
    const access = "long-past-expiry-access-fake";
    const refresh = "copilot-github-token-fake";
    fixture.writeAuthJson(JSON.stringify({
      "openai-codex": { type: "oauth", access, refresh, expires: Date.now() - 365 * 24 * 60 * 60 * 1000 },
      "github-copilot": { type: "oauth", access, refresh, expires: Date.now() - 365 * 24 * 60 * 60 * 1000 },
    }));
    const outcomes = await resolveProviderCredentials(input());
    const codex = findProvider(outcomes, "openai-codex");
    expect(codex?.status).toBe("ready");
    expect(bearerEquals(bearerOf(codex), access)).toBe(true);
    // Copilot keeps its long-lived refresh-field usage bearer; access expiry is irrelevant.
    const copilot = findProvider(outcomes, "github-copilot");
    expect(copilot?.status).toBe("ready");
    expect(bearerEquals(bearerOf(copilot), refresh)).toBe(true);
  });

  it("rejects a stored OAuth credential for a provider without OAuth usage support", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      deepseek: { type: "oauth", access: "ds-access-fake", refresh: "ds-refresh-fake", expires: farFutureExpires },
    }));
    const deepseek = (await resolveProviderCredentials(input())).find((o) => o.providerId === "deepseek");
    expect(deepseek?.status).toBe("unavailable");
    expect(deepseek?.source).toBe("auth.json");
    expect(deepseek?.status === "unavailable" ? /kind/.test(deepseek.reason) : false).toBe(true);
  });

  it("rejects a stored API-key credential for the OAuth-only codex provider", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      "openai-codex": { type: "api_key", key: "codex-api-key-fake" },
    }));
    const codex = (await resolveProviderCredentials(input())).find((o) => o.providerId === "openai-codex");
    expect(codex?.status).toBe("unavailable");
    expect(codex?.status === "unavailable" ? /kind/.test(codex.reason) : false).toBe(true);
  });

  it("keeps ready notes that distinguish configuration-only resolution", async () => {
    fixture = createTemporaryAgentDir();
    fixture.writeAuthJson(JSON.stringify({
      "openai-codex": { type: "oauth", access: "access-token-fake", refresh: "refresh-token-fake", expires: farFutureExpires },
    }));
    const codex = (await resolveProviderCredentials(input())).find((o) => o.providerId === "openai-codex");
    expect(codex?.status).toBe("ready");
    const joined = codex?.status === "ready" ? codex.notes.join(" ") : "";
    expect(/no OAuth refresh/.test(joined)).toBe(true);
    expect(/local-clock expiry evaluation/.test(joined)).toBe(true);
    expect(/active Pi session/.test(joined)).toBe(true);
  });
});

function findProvider(
  outcomes: readonly { providerId: string; status: string; source: string; reason?: string; authorization?: string; capabilities?: never }[],
  providerId: string,
) {
  return outcomes.find((outcome) => outcome.providerId === providerId);
}

function bearerOf(outcome: { status: string; authorization?: string } | undefined): string | undefined {
  return outcome?.status === "ready" ? outcome.authorization : undefined;
}

function reasonContains(outcome: { status: string; reason?: string } | undefined, fragment: string): boolean {
  return outcome?.status === "unavailable" ? outcome.reason?.includes(fragment) === true : false;
}
