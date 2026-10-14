import { mkdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInspect } from "../src/inspect.js";
import { resolveProviderCredentials } from "../src/configuration.js";
import { createTemporaryAgentDir, fakeEnv, leaksValue, type TempAgentDir } from "./support.js";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe("inspect CLI (masked development tooling)", () => {
  let fixture!: TempAgentDir;
  beforeEach(() => {
    fixture = createTemporaryAgentDir();
  });
  afterEach(() => {
    fixture.dispose();
  });

  it("prints masked ready and unavailable lines from synthetic fixtures", async () => {
    const stored = "cli-suitable-stored-value-long";
    const ambient = "cli-ambient-fake-value-long!";
    fixture.writeAuthJson(JSON.stringify({ deepseek: { type: "api_key", key: stored } }));
    fixture.writeModelsJson(JSON.stringify({ providers: { openrouter: { apiKey: "$FAKE_MISSING_KEY" } } }));
    const { lines, write } = collect();
    // Every automated CLI test supplies an explicit synthetic environment.
    const exit = await runInspect(
      ["--agent-dir", fixture.root, "deepseek", "openrouter"],
      write,
      fakeEnv({ DEEPSEEK_API_KEY: ambient }),
    );
    expect(exit).toBe(0);
    // Ready line carries a masked credential fragment.
    const deepseek = lines.join("\n").split("\n").find((l) => l.startsWith("deepseek"));
    expect(deepseek?.includes("ready  source=auth.json  credential=")).toBe(true);
    expect(deepseek?.includes("[masked]")).toBe(true);
    // Unavailable line stays listed with a safe reason.
    const openrouter = lines.join("\n").split("\n").find((l) => l.startsWith("openrouter"));
    expect(openrouter?.includes("unavailable  source=models.json")).toBe(true);
    expect(openrouter?.includes("models.json credential has no resolvable key value")).toBe(true);
    // Complete values/names never reach the output.
    expect(leaksValue(stored, lines.join("\n"))).toBe(false);
    expect(leaksValue(ambient, lines.join("\n"))).toBe(false);
  });

  it("reports a safe failure and usage for missing arguments (exit 2)", async () => {
    const { lines, write } = collect();
    const exit = await runInspect([], write);
    expect(exit).toBe(2);
    expect(lines[0]).toBe("usage: inspect --agent-dir <directory> [provider ...]");
    expect(lines.join("\n")).not.toContain("agent-dir <directory value");
  });

  it("rejects unknown options with safe output only (exit 2)", async () => {
    const { lines, write } = collect();
    const exit = await runInspect(["--nonsense", "value"], write);
    expect(exit).toBe(2);
    const joined = lines.join("\n");
    expect(joined.includes("nonsense")).toBe(false);
    expect(joined.startsWith("inspection failed")).toBe(true);
  });

  it("rejects unsupported provider IDs without touching configuration (exit 2)", async () => {
    const { lines, write } = collect();
    const exit = await runInspect(["--agent-dir", fixture.root, "made-up-provider"], write);
    expect(exit).toBe(2);
    expect(lines.join("\n").startsWith("unsupported provider ID requested")).toBe(true);
  });

  it("handles an unreadable agent directory (file-shaped agent dir) with safe failure output", async () => {
    fixture.dispose();
    fixture = createTemporaryAgentDir();
    // A directory named auth.json cannot be read as a file: every provider
    // resolves to a fixed safe file-error result (no content, no raw error).
    mkdirSync(fixture.authPath);
    const { lines, write } = collect();
    const exit = await runInspect(["--agent-dir", fixture.root, "deepseek"], write, fakeEnv({}));
    expect(exit).toBe(0);
    const line = lines.join("\n");
    expect(line.includes("unavailable  source=auth.json")).toBe(true);
    expect(line.includes("could not be read reliably")).toBe(true);
  });

  it("treats a missing agent directory as absent configuration, not a crash", async () => {
    const { lines, write } = collect();
    const exit = await runInspect(
      ["--agent-dir", "/does/not/exist-anything", "deepseek"],
      write,
      fakeEnv({}),
    );
    expect(exit).toBe(0);
    expect(lines.join("\n").includes("not-configured")).toBe(true);
  });

  it("never consults process environment when an environment map is supplied", async () => {
    const sentinelName = "FAKE_SENTINEL_ISOLATION_VAR";
    process.env[sentinelName] = "sentinel-isolation-value-A";
    try {
      // A models.json key references the sentinel variable, but the supplied
      // environment map is empty: the sentinel must not resolve.
      fixture.writeModelsJson(JSON.stringify({ providers: { deepseek: { apiKey: `$${sentinelName}` } } }));
      const outcomes = await resolveProviderCredentials({
        authPath: fixture.authPath,
        modelsJsonPath: fixture.modelsPath,
        environment: fakeEnv({}),
      });
      const outcome = outcomes.find((o) => o.providerId === "deepseek");
      expect(outcome?.status).toBe("unavailable");
      expect(outcome?.source).toBe("models.json");
      // The sentinel value never appears anywhere (boolean-only assertion).
      expect(leaksValue("sentinel-isolation-value-A", JSON.stringify(outcomes))).toBe(false);
      // Without a supplied environment, process.env IS consulted: the sentinel resolves.
      const ambientOutcomes = await resolveProviderCredentials({
        authPath: fixture.authPath,
        modelsJsonPath: fixture.modelsPath,
      });
      const ambientOutcome = ambientOutcomes.find((o) => o.providerId === "deepseek");
      expect(ambientOutcome?.status).toBe("ready");

      // CLI variant: an explicit injected map also shields runInspect itself.
      const { lines, write } = collect();
      const exit = await runInspect(
        ["--agent-dir", fixture.root, "deepseek"],
        write,
        fakeEnv({}),
      );
      expect(exit).toBe(0);
      expect(lines.join("\n").includes("unavailable  source=models.json")).toBe(true);
    } finally {
      delete process.env[sentinelName];
    }
  });

  it("models key and header command values never execute and produce a safe reason", async () => {
    fixture.writeModelsJson(JSON.stringify({
      providers: { deepseek: { apiKey: "! cmd does not execute" } },
    }));
    const { lines, write } = collect();
    const exit = await runInspect(
      ["--agent-dir", fixture.root, "deepseek"],
      write,
      fakeEnv({ DEEPSEEK_API_KEY: "ambient-never-used-undefined" }),
    );
    expect(exit).toBe(0);
    const line = lines.join("\n");
    expect(line.includes("unavailable  source=models.json")).toBe(true);
    expect(line.includes("command values are not supported")).toBe(true);
  });
});
