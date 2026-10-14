import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveProviderCredentials } from "../src/configuration.js";
import { createTemporaryAgentDir, fakeEnv, type TempAgentDir } from "./support.js";

/**
 * No-side-effect guarantees: no network, no file writes, and unchanged file
 * content across resolution. Command values never execute (fixture uses a
 * nonexistent command; any execution would surface as a failure or a runner
 * error, and the resolved values prove the command output is not used).
 */
describe("resolution side-effect safety", () => {
  let fixture!: TempAgentDir;
  beforeEach(() => {
    fixture = createTemporaryAgentDir();
  });
  afterEach(() => {
    fixture.dispose();
  });

  it("makes no network requests during resolution", async () => {
    fixture.writeAuthJson("{}");
    fixture.writeModelsJson("{}");
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used during resolution");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await resolveProviderCredentials({
        authPath: fixture.authPath,
        modelsJsonPath: fixture.modelsPath,
        environment: fakeEnv({}),
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves configuration files byte-identical and writes nothing", async () => {
    const authContent = JSON.stringify({ deepseek: { type: "api_key", key: "no-write-secret-value" } });
    const modelsContent = JSON.stringify({ providers: { deepseek: { apiKey: "no-writeSecretToo" } } });
    fixture.writeAuthJson(authContent);
    fixture.writeModelsJson(modelsContent);
    const authBefore = readFileSync(fixture.authPath);
    const modelsBefore = readFileSync(fixture.modelsPath);
    const entriesBefore = readdirSync(fixture.root).sort();

    await resolveProviderCredentials({
      authPath: fixture.authPath,
      modelsJsonPath: fixture.modelsPath,
      environment: fakeEnv({}),
    });

    expect(readFileSync(fixture.authPath).equals(authBefore)).toBe(true);
    expect(readFileSync(fixture.modelsPath).equals(modelsBefore)).toBe(true);
    // No new configuration file appears in the fixture directory.
    expect(readdirSync(fixture.root).sort().join(",")).toBe(entriesBefore.join(","));
  });

  it("never executes credential command values and does not fall through", async () => {
    const sentinelPath = join(fixture.root, "sentinel.sh");
    fixture.writeAuthJson(JSON.stringify({
      deepseek: { type: "api_key", key: `! ${sentinelPath}` },
    }));
    const outcome = (await resolveProviderCredentials({
      authPath: fixture.authPath,
      modelsJsonPath: fixture.modelsPath,
      environment: fakeEnv({ DEEPSEEK_API_KEY: "ambient-must-not-be-used" }),
    })).find((o) => o.providerId === "deepseek");
    expect(outcome?.status).toBe("unavailable");
    // The command target file was never created nor invoked as a side effect.
    let sentinelExists = false;
    try {
      sentinelExists = statSync(sentinelPath).isFile();
    } catch {
      sentinelExists = false;
    }
    expect(sentinelExists).toBe(false);
  });
});
