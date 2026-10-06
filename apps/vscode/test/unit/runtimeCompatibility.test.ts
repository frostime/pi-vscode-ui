import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { configuredPiInvocation } from "../../src/extension/configuration/configuredPiInvocation.js";
import { runtimeCompatibilityProfile } from "../../src/extension/configuration/runtimeCompatibility.js";

describe("runtime compatibility profiles", () => {
  it("keeps Pi defaults and settings projections", () => {
    const profile = runtimeCompatibilityProfile("pi");
    expect(profile.usesPiSettings).toBe(true);
    expect(profile.capabilities).toEqual({
      sessionTree: true,
      fork: true,
      slashCommands: true,
      questionTool: true,
    });
    expect(profile.defaultSessionRoot()).toBe(join(homedir(), ".pi", "agent", "sessions"));
    expect(configuredPiInvocation(undefined, "pi")).toEqual({});
  });

  it("uses the platform OMP command while keeping an explicit executable authoritative", () => {
    const expectedCommand = process.platform === "win32" ? "omp.exe" : "omp";
    expect(runtimeCompatibilityProfile("oh-my-pi")).toMatchObject({
      id: "oh-my-pi",
      executableFallback: expectedCommand,
      usesPiSettings: false,
      capabilities: {
        sessionTree: false,
        fork: false,
        slashCommands: true,
        questionTool: true,
      },
    });
    expect(configuredPiInvocation(undefined, "oh-my-pi")).toEqual({ command: expectedCommand });
    expect(configuredPiInvocation("custom-omp", "oh-my-pi")).toEqual({ command: "custom-omp" });
    expect(configuredPiInvocation("C:/tools/omp.cjs", "oh-my-pi")).toEqual({
      command: process.platform === "win32" ? "node.exe" : "node",
      commandArgs: ["C:/tools/omp.cjs"],
    });
  });
});
