import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RpcModel } from "@frostime/pi-rpc";

import { resolveModelScopePatterns, resolvePiModelScope, selectModelPatterns } from "../../src/extension/models/resolvePiModelScope.js";

const models: RpcModel[] = [
  { provider: "opencode-go", id: "glm-5.1", name: "GLM 5.1" },
  { provider: "opencode-go", id: "glm-5.1-20260701", name: "GLM 5.1 (dated)" },
  { provider: "opencode-go", id: "kimi-k2.6" },
  { provider: "deepseek", id: "deepseek-v4-pro" },
  { provider: "deepseek", id: "deepseek-v4-pro-20260601" },
  { provider: "other", id: "glm-5.1" },
];

describe("Pi model scope resolution", () => {
  it("matches provider globs, bare ids, and removes duplicate matches", () => {
    expect(resolveModelScopePatterns(["opencode-go/glm*", "glm-5.1"], models)).toEqual([
      "opencode-go/glm-5.1",
      "opencode-go/glm-5.1-20260701",
    ]);
  });

  it("keeps a configured thinking suffix out of the model key", () => {
    expect(resolveModelScopePatterns(["opencode-go/*:high"], models)).toEqual([
      "opencode-go/glm-5.1",
      "opencode-go/glm-5.1-20260701",
      "opencode-go/kimi-k2.6",
    ]);
  });

  it("prefers an undated alias for a fuzzy pattern", () => {
    expect(resolveModelScopePatterns(["deepseek-v4"], models)).toEqual(["deepseek/deepseek-v4-pro"]);
  });

  it("uses CLI models before project and global settings", () => {
    expect(selectModelPatterns(
      ["--mode", "rpc", "--models", "cli/*"],
      { enabledModels: ["global/*"] },
      { enabledModels: ["project/*"] },
    )).toEqual(["cli/*"]);
  });

  it("uses project settings before global settings, including empty or invalid values", () => {
    expect(selectModelPatterns([], { enabledModels: ["global/*"] }, { enabledModels: ["project/*"] }))
      .toEqual(["project/*"]);
    expect(selectModelPatterns([], { enabledModels: ["global/*"] }, { enabledModels: [] }))
      .toEqual([]);
    expect(selectModelPatterns([], { enabledModels: ["global/*"] }, { enabledModels: {} }))
      .toEqual([]);
    expect(selectModelPatterns([], { enabledModels: ["global/*"] }, { enabledModels: ["project/*", 42] }))
      .toEqual([]);
  });

  it("resolves a relative PI_CODING_AGENT_DIR from the session cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-model-scope-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      await mkdir(join(cwd, ".config", "pi"), { recursive: true });
      await writeFile(
        join(cwd, ".config", "pi", "settings.json"),
        JSON.stringify({ enabledModels: ["opencode-go/glm-5.1"] }),
      );
      process.env.PI_CODING_AGENT_DIR = ".config/pi";

      await expect(resolvePiModelScope(cwd, [], models)).resolves.toEqual(["opencode-go/glm-5.1"]);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
