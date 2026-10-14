import { afterEach, describe, expect, it, vi } from "vitest";

import { maskEnvName, maskSecret, redactWithSecrets } from "../src/masking.js";
import { buildMaskedInspectionReport } from "../src/inspection.js";
import { createTemporaryAgentDir, fakeEnv, leaksValue, type TempAgentDir } from "./support.js";

describe("masking rules", () => {
  it("fully masks short values so fragments cannot reconstruct them", () => {
    expect(maskSecret("abc")).toBe("[masked]");
    expect(maskSecret("")).toBe("[masked]");
  });

  it("masks sufficiently long values with a fixed mask and short edges", () => {
    const masked = maskSecret("a-very-long-secret-token-value");
    expect(masked.startsWith("a-v…[masked]…")).toBe(true);
    expect(masked.length).toBeLessThan("a-very-long-secret-token-value".length);
    expect(maskSecret("shortval")).toBe("[masked]");
  });

  it("applies the same fixed mask to environment names", () => {
    expect(maskEnvName("SHORT_NAME")).toBe("[masked]");
    expect(maskEnvName("VERY_LONG_ENVIRONMENT_VARIABLE_NAME")).toContain("[masked]");
    // Masked output never equals the input.
    expect(maskEnvName("VERY_LONG_ENVIRONMENT_VARIABLE_NAME")).not.toBe("VERY_LONG_ENVIRONMENT_VARIABLE_NAME");
  });

  it("redacts known secrets and bearer tokens from error text", () => {
    const secret = "super-secret-token-value!";
    const redacted = redactWithSecrets(`Request failed with Bearer ${secret} and {"access_token": "${secret}"}`, [secret]);
    // Boolean assertions only: the secret must not appear; failure shows booleans.
    expect(redacted.includes(secret)).toBe(false);
    expect(redacted.includes("Bearer [redacted]")).toBe(false);
    expect(redacted.includes("<redacted>") || redacted.includes("Bearer <redacted>")).toBe(true);
  });

  it("sanitizes control characters out of display text", () => {
    expect(redactWithSecrets("line\u0007bell\u001B[31mredaction", [])).not.toContain("\u001B");
  });
});

/** The inspection reporter must be safe on any resolved outcome (fake fixtures). */
describe("inspection formatting", () => {
  let fixtureDir!: TempAgentDir;
  afterEach(() => {
    fixtureDir.dispose();
  });

  it("masks ambient names and credential fragments in the inspection report", async () => {
    fixtureDir = createTemporaryAgentDir();
    const stored = "inspection-fixture-stored-value-long";
    const ambient = "inspection-fixture-ambient-value-long";
    fixtureDir.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: stored } }));
    fixtureDir.writeModelsJson(JSON.stringify({ providers: {} }));
    const report = await buildMaskedInspectionReport({
      authPath: fixtureDir.authPath,
      modelsJsonPath: fixtureDir.modelsPath,
      environment: fakeEnv({ FIREWORKS_API_KEY: ambient }),
      includeAmbientEnvName: true,
    });

    const deepseekLine = report.split("\n").find((line) => line.startsWith("deepseek"));
    expect(deepseekLine?.startsWith("deepseek  ready  source=auth.json  credential=")).toBe(true);
    const fireworksLine = report.split("\n").find((line) => line.startsWith("fireworks"));
    expect(fireworksLine?.includes("source=environment")).toBe(true);
    // Ambient name is masked with a partial view (inspector-only).
    expect(fireworksLine?.includes("name=FIR…[masked]…KEY")).toBe(true);
    // Complete variable names and complete credential values never appear.
    const fireworks = report.split("\n").find((line) => line.startsWith("fireworks"));
    expect(fireworks?.includes("ready")).toBe(true);
    expect(leaksValue(stored, report)).toBe(false);
    expect(leaksValue(ambient, report)).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await buildMaskedInspectionReport({
        authPath: fixtureDir.authPath,
        modelsJsonPath: fixtureDir.modelsPath,
        environment: fakeEnv({}),
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
