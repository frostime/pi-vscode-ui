import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedProviderCredential } from "../src/types.js";
import { resolveProviderCredentials } from "../src/configuration.js";
import { listProviders } from "../src/listProviders.js";
import { authorizationEquals, bearerEquals, createTemporaryAgentDir, fakeEnv, leaksValue, type TempAgentDir } from "./support.js";

describe("credential resolution — precedence and configuration", () => {
  let fixture!: TempAgentDir;
  beforeEach(() => {
    fixture = createTemporaryAgentDir();
  });
  afterEach(() => {
    fixture.dispose();
  });

  const configInput = () => ({ authPath: fixture.authPath, modelsJsonPath: fixture.modelsPath });

  const resolveOutcome = async (
    input: Parameters<typeof resolveProviderCredentials>[0],
    providerId: string,
  ): Promise<ResolvedProviderCredential | undefined> => findProvider(await resolveProviderCredentials(input), providerId);

  function findProvider(
    outcomes: readonly ResolvedProviderCredential[],
    providerId: string,
  ): ResolvedProviderCredential | undefined {
    return outcomes.find((outcome) => outcome.providerId === providerId);
  }

  function bearerOf(outcome: ResolvedProviderCredential | undefined): string | undefined {
    return outcome?.status === "ready" ? outcome.authorization : undefined;
  }

  function reasonContains(outcome: ResolvedProviderCredential | undefined, fragment: string): boolean {
    return outcome?.status === "unavailable" ? outcome.reason.includes(fragment) : false;
  }

  /** Boolean-only check: the fixture value never appears in the outcome evidence. */
  function valueNeverDisplayed(value: string, outcome: unknown): void {
    expect(leaksValue(value, JSON.stringify(outcome))).toBe(false);
  }

  it("optionally includes unconfigured supported providers so absence means unsupported", async () => {
    const input = { ...configInput(), environment: fakeEnv({}) };
    expect(await listProviders(input)).toEqual([]);
    const catalog = await listProviders(input, { includeUnconfigured: true });
    const codex = catalog.find((item) => item.providerId === "openai-codex");
    expect(codex?.availability).toBe("unavailable");
    expect(codex?.source).toBe("not-configured");
    expect(catalog.some((item) => item.providerId === "unsupported-custom-provider")).toBe(false);
  });

  it("lists maintained official links independently of query availability, without inventing links for other providers", async () => {
    const key = "synthetic-link-test-key";
    fixture.writeAuthJson(JSON.stringify({
      openai: { type: "api_key", key },
      "openai-codex": { type: "api_key", key },
      "opencode-go": { type: "api_key", key },
      deepseek: { type: "api_key", key },
    }));
    const descriptors = await listProviders({ ...configInput(), environment: fakeEnv({}) });
    for (const id of ["openai", "openai-codex"]) {
      const descriptor = descriptors.find((item) => item.providerId === id);
      expect(descriptor?.availability).toBe("unavailable");
      expect(descriptor?.links).toEqual([{ label: "View usage on ChatGPT", url: "https://chatgpt.com/settings/usage" }]);
    }
    expect(descriptors.find((item) => item.providerId === "opencode-go")?.links).toEqual([
      { label: "Open OpenCode console", url: "https://opencode.ai/console" },
    ]);
    expect(descriptors.find((item) => item.providerId === "deepseek")?.links).toBeUndefined();
    valueNeverDisplayed(key, descriptors);
  });

  it("prefers a stored auth.json credential over models.json and ambient variables", async () => {
    const stored = "stored-secret-value-A";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: stored } }));
    fixture.writeModelsJson(JSON.stringify({ providers: { deepseek: { apiKey: "models-secret-value-A" } } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-secret-value-A" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("ready");
    expect(outcome?.source).toBe("auth.json");
    expect(bearerEquals(bearerOf(outcome), stored)).toBe(true);
  });

  it("uses provider-level models.json apiKey when nothing is stored", async () => {
    const models = "models-only-secret-value-A";
    fixture.writeModelsJson(JSON.stringify({ providers: { deepseek: { apiKey: models } } }));
    const outcome = await resolveOutcome({ ...configInput(), environment: fakeEnv({}) }, "deepseek");
    expect(outcome?.status).toBe("ready");
    expect(outcome?.source).toBe("models.json");
    expect(bearerEquals(bearerOf(outcome), models)).toBe(true);
  });

  it("resolves predefined ambient variables last", async () => {
    const ambient = "ambient-only-secret-value-A";
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: ambient }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("ready");
    expect(outcome?.source).toBe("environment");
    expect(bearerEquals(bearerOf(outcome), ambient)).toBe(true);
  });

  it("ready notes describe the real provenance per source category", async () => {
    fixture.writeModelsJson(JSON.stringify({ providers: { deepseek: { apiKey: "models-notes-secret-A" } } }));
    const modelsOutcomes = await resolveProviderCredentials({ ...configInput(), environment: fakeEnv({}) });
    const modelsResult = findProvider(modelsOutcomes, "deepseek");
    expect(modelsResult?.source).toBe("models.json");
    expect(notesMention(modelsResult, "models.json configuration")).toBe(true);
    expect(notesMention(modelsResult, "predefined environment variable")).toBe(false);

    // A fresh fixture directory has no models.json; the ambient path applies.
    const withoutModels = createTemporaryAgentDir();
    try {
      const ambientOutcomes = await resolveProviderCredentials({
        agentDirectory: withoutModels.root,
        environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-notes-value-A" }),
      });
      const ambientResult = findProvider(ambientOutcomes, "deepseek");
      expect(ambientResult?.source).toBe("environment");
      expect(notesMention(ambientResult, "predefined environment variable")).toBe(true);
      expect(notesMention(ambientResult, "models.json configuration")).toBe(false);
    } finally {
      withoutModels.dispose();
    }
  });

  it("resolves `$ENV` references in stored keys via credential-local env first", async () => {
    const local = "credential-local-secret-A";
    fixture.writeAuthJson(JSON.stringify({
      deepseek: { type: "api_key", key: "$FAKE_LOCAL_KEY", env: { FAKE_LOCAL_KEY: local } },
    }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ FAKE_LOCAL_KEY: "outer-ignored-value-A" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("ready");
    expect(bearerEquals(bearerOf(outcome), local)).toBe(true);
  });

  it("an explicit stored key that cannot resolve never substitutes the ambient credential", async () => {
    const ambient = "ambient-never-used-value-A";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: "$FAKE_MISSING_KEY", env: {} } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: ambient }) },
      "deepseek",
    );
    // Different ambient credential is configured, but the explicit source blocks it.
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("auth.json");
    expect(reasonContains(outcome, "no resolvable key value")).toBe(true);
    valueNeverDisplayed(ambient, outcome);
  });

  it("a keyless explicit stored entry never substitutes the ambient credential", async () => {
    const ambient = "ambient-never-used-value-B";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", env: {} } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: ambient }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("auth.json");
    valueNeverDisplayed(ambient, outcome);
  });

  it("an explicit stored credential resolving to an empty value never substitutes the ambient credential", async () => {
    const ambient = "ambient-never-used-value-C";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: "" } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: ambient }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("auth.json");
    valueNeverDisplayed(ambient, outcome);
  });

  it("never falls back from a stored command value to another account (no execution)", async () => {
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: "! some-echo-command" } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-unused-value-A" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("auth.json");
    expect(reasonContains(outcome, "command")).toBe(true);
    valueNeverDisplayed("ambient-unused-value-A", outcome);
  });

  it("a malformed auth.json blocks every credential source with a fixed file-error result", async () => {
    fixture.writeAuthJson(`{ this is not json ; secret-token-value-A`);
    const outcomes = await resolveProviderCredentials({
      ...configInput(),
      environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-value-A", OPENROUTER_API_KEY: "ambient-value-B" }),
    });
    for (const providerId of ["deepseek", "openrouter"]) {
      const outcome = findProvider(outcomes, providerId);
      expect(outcome?.status).toBe("unavailable");
      expect(outcome?.source).toBe("auth.json");
      expect(reasonContains(outcome, "could not be read reliably")).toBe(true);
    }
    // Ambient credentials are never used to substitute a broken file.
    valueNeverDisplayed("ambient-value-A", outcomes);
    // Malformed file content (and the fake secret fragment inside) never leaks.
    valueNeverDisplayed("secret-token-value-A", outcomes);
  });

  it("an unreadable auth.json (EISDIR) blocks resolution with the same file-error result", async () => {
    fixture.dispose();
    fixture = createTemporaryAgentDir();
    mkdirSync(join(fixture.authPath)); // a directory named auth.json cannot be read as a file
    const outcomes = await resolveProviderCredentials({
      ...configInput(),
      environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-value-A" }),
    });
    const outcome = findProvider(outcomes, "deepseek");
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("auth.json");
    valueNeverDisplayed("ambient-value-A", outcomes);
  });

  it("a malformed models.json blocks resolution even for a usable stored credential (structural conservatism)", async () => {
    const stored = "stored-secret-while-models-broken";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: stored } }));
    fixture.writeModelsJson("{ broken models json ; secret-noise-A");
    const outcomes = await resolveProviderCredentials({
      ...configInput(),
      environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-while-models-broken" }),
    });
    const outcome = findProvider(outcomes, "deepseek");
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("models.json");
    // The stored credential is withheld too: endpoint/header facts are unverifiable.
    valueNeverDisplayed(stored, outcomes);
    valueNeverDisplayed("ambient-while-models-broken", outcomes);
    valueNeverDisplayed("secret-noise-A", outcomes);
  });

  it("a models.json key with a missing env reference stays unavailable with its own source (listed)", async () => {
    fixture.writeModelsJson(JSON.stringify({ providers: { deepseek: { apiKey: "$FAKE_MISSING_KEY" } } }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-unused-value-D" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("models.json");
    valueNeverDisplayed("ambient-unused-value-D", outcome);
    const descriptors = await listProviders({ ...configInput(), environment: fakeEnv({}) });
    expect(descriptors.find((d) => d.providerId === "deepseek")?.source).toBe("models.json");
  });

  it("an explicitly empty configured Authorization header is unavailable, never a ready empty bearer", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { apiKey: "key-value-secret-A", headers: { Authorization: "" } } },
    }));
    const outcome = await resolveOutcome({ ...configInput(), environment: fakeEnv({}) }, "deepseek");
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("models.json");
    expect(reasonContains(outcome, "empty")).toBe(true);
    expect(bearerOf(outcome)).toBeUndefined();
  });

  it("an empty explicit Authorization header blocks the ambient path too (no fallback)", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { headers: { Authorization: "" } } },
    }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-unused-value-E" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(reasonContains(outcome, "empty")).toBe(true);
    valueNeverDisplayed("ambient-unused-value-E", outcome);
  });

  it("resolves models.json headers with the credential env chain and authHeader overrides authorization", async () => {
    const credentialLocal = "credential-local-header-A";
    fixture.writeAuthJson(JSON.stringify({
      deepseek: { type: "api_key", key: "key-value-secret-A", env: { FAKE_HEADER_VAR: credentialLocal } },
    }));
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { headers: { "X-Fake-Header": "$FAKE_HEADER_VAR" }, authHeader: true } },
    }));
    const outcome = await resolveOutcome({ ...configInput(), environment: fakeEnv({}) }, "deepseek");
    expect(outcome?.status).toBe("ready");
    if (outcome?.status !== "ready") return;
    expect(authorizationEquals(outcome.authorization, "Bearer key-value-secret-A")).toBe(true);
    expect(outcome.secrets.includes(credentialLocal)).toBe(true);
  });

  it("marks providers unavailable when a configured header cannot resolve", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { apiKey: "key-value-secret-A", headers: { Authorization: "$FAKE_MISSING_KEY" } } },
    }));
    const outcome = await resolveOutcome({ ...configInput(), environment: fakeEnv({}) }, "deepseek");
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.source).toBe("models.json");
  });

  it("rejects credentials when the configured endpoint is not an official origin", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { baseUrl: "https://fake-proxy.invalid" } },
    }));
    const outcome = await resolveOutcome(
      { ...configInput(), environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-secret-proxy-A" }) },
      "deepseek",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(reasonContains(outcome, "official origin")).toBe(true);
  });

  it("keeps DeepSeek bearer-requirement evidence for non-Bearer configured authorization", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { apiKey: "key-value-secret-A", headers: { Authorization: "Basic tokens-value" } } },
    }));
    const outcome = await resolveOutcome({ ...configInput(), environment: fakeEnv({}) }, "deepseek");
    expect(outcome?.status).toBe("unavailable");
    expect(reasonContains(outcome, "Bearer")).toBe(true);
  });

  it("reports the OpenAI API-key rejection for non-OAuth sources", async () => {
    const outcome = findProvider(
      await resolveProviderCredentials({ ...configInput(), environment: fakeEnv({ OPENAI_API_KEY: "ambient-openai-key-A" }) }),
      "openai",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(reasonContains(outcome, "API-key usage reporting is not supported")).toBe(true);
  });

  it("reports the xAI API-key rejection for non-OAuth sources", async () => {
    const outcome = findProvider(
      await resolveProviderCredentials({ ...configInput(), environment: fakeEnv({ XAI_API_KEY: "ambient-xai-key-A" }) }),
      "xai",
    );
    expect(outcome?.status).toBe("unavailable");
    expect(reasonContains(outcome, "OAuth subscription account")).toBe(true);
  });

  it("lists only configured providers with safe reasons and no variable names", async () => {
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: "stored-secret-value-A" } }));
    const descriptors = await listProviders({ ...configInput(), environment: fakeEnv({}) });
    const deepseekDescriptor = descriptors.find((d) => d.providerId === "deepseek");
    expect(deepseekDescriptor?.availability).toBe("ready");
    expect(deepseekDescriptor?.source).toBe("auth.json");
    // Unconfigured built-ins are not listed.
    expect(descriptors.map((d) => d.providerId).includes("openrouter")).toBe(false);

    // Safe descriptor boundary: no canonical ambient variable names appear.
    const text = JSON.stringify(descriptors);
    for (const canonicalName of ["DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "MOONSHOT_API_KEY"]) {
      expect(leaksValue(canonicalName, text)).toBe(false);
    }
  });

  it("keeps the Moonshot region guard: the shared variable resolves no credential", async () => {
    const outcomes = await resolveProviderCredentials({
      ...configInput(),
      environment: fakeEnv({ MOONSHOT_API_KEY: "shared-moonshot-secret-A" }),
    });
    const cn = findProvider(outcomes, "moonshotai-cn");
    const global = findProvider(outcomes, "moonshotai");
    expect(cn?.status).toBe("unavailable");
    expect(global?.status).toBe("unavailable");
    expect(reasonContains(cn, "region")).toBe(true);
    valueNeverDisplayed("shared-moonshot-secret-A", outcomes);
  });

  it("resolves an explicit stored Moonshot CN credential while the shared variable stays unused", async () => {
    const stored = "cn-stored-secret-A";
    fixture.writeAuthJson(JSON.stringify({ "moonshotai-cn": { type: "api_key", key: stored } }));
    const outcome = findProvider(
      await resolveProviderCredentials({
        ...configInput(),
        environment: fakeEnv({ MOONSHOT_API_KEY: "shared-not-used-value-A" }),
      }),
      "moonshotai-cn",
    );
    expect(outcome?.status).toBe("ready");
    expect(outcome?.source).toBe("auth.json");
    expect(bearerEquals(bearerOf(outcome), stored)).toBe(true);
  });
});

function notesMention(outcome: { status: string; notes?: readonly string[] } | undefined, fragment: string): boolean {
  return outcome?.status === "ready" && outcome.notes !== undefined ? outcome.notes.join(" ").includes(fragment) : false;
}
