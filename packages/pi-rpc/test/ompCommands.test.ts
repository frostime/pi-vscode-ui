import { describe, expect, it } from "vitest";

import { ohMyPiRpcDialect } from "../src/dialects/ohMyPi/ohMyPiRpcDialect.js";
import { ompCommandDescriptors } from "../src/dialects/ohMyPi/ompCommands.js";

const commands = [
  { name: "model", source: "builtin", aliases: ["models"] },
  { name: "ui", source: "extension" },
  { name: "script", source: "custom" },
  { name: "remote", source: "mcp_prompt" },
  { name: "review", source: "file", description: "Review code", input: { hint: "scope" }, extra: 42 },
  { name: "skill:testing", source: "skill", description: "Testing skill" },
  { name: "plugin:review", source: "file" },
];

describe("bounded OMP command discovery", () => {
  it("adapts Markdown commands and skills without exposing executable handlers", () => {
    expect(ompCommandDescriptors(commands)).toEqual([
      { ...commands[4], source: "prompt", runtimeSource: "file" },
      { ...commands[5], runtimeSource: "skill" },
      { ...commands[6], source: "prompt", runtimeSource: "file" },
    ]);
  });

  it("does not advertise file names intercepted by builtin aliases, colon parsing, or other handlers", () => {
    expect(ompCommandDescriptors([
      ...commands,
      { name: "model:foo", source: "file" },
      { name: "models:foo", source: "file" },
      { name: "ui", source: "file" },
      { name: "script", source: "file" },
      { name: "remote", source: "file" },
      { name: "skill:other", source: "file" },
    ]).map((command) => command.name)).toEqual(["review", "skill:testing", "plugin:review"]);
  });

  it("preserves collision-namespaced skills and nested file-command names", () => {
    expect(ompCommandDescriptors([
      { name: "skill:package/testing", source: "skill" },
      { name: "package/review", source: "file" },
    ])).toEqual([
      { name: "skill:package/testing", source: "skill", runtimeSource: "skill" },
      { name: "package/review", source: "prompt", runtimeSource: "file" },
    ]);
  });

  it("closes discovery for malformed records and unknown categories", () => {
    expect(ompCommandDescriptors([
      null, { name: "missing" }, { name: "future", source: "new-type" },
      { name: "two words", source: "file" }, { name: "/slash", source: "file" },
      { name: "invalid", source: "skill" }, { name: "skill:", source: "skill" },
    ])).toEqual([]);
    expect(() => ompCommandDescriptors(undefined)).toThrow("command list");
  });

  it("uses the same projection for discovery responses and live metadata updates", () => {
    const normalized = ompCommandDescriptors(commands);
    expect(ohMyPiRpcDialect.normalizeCommand?.({ type: "get_commands", id: "req_1" }))
      .toEqual({ type: "get_available_commands", id: "req_1" });
    expect(ohMyPiRpcDialect.normalizeResponseData?.({ type: "get_commands" }, { commands, extra: true }))
      .toEqual({ commands: normalized, extra: true });
    expect(ohMyPiRpcDialect.normalizeEvent({ type: "available_commands_update", commands }))
      .toEqual({ type: "commands_changed", commands: normalized });
    expect(ohMyPiRpcDialect.normalizeEvent({ type: "available_commands_update", commands: null }))
      .toEqual({ type: "commands_changed", commands: [] });
  });

  it("preserves prompting and terminal facts rather than treating every prompt result as settlement", () => {
    const prompt = { type: "prompt", message: "/review args" };
    const result = { type: "prompt_result", id: "req_2", agentInvoked: false, status: "error", sessionSettled: false };
    expect(ohMyPiRpcDialect.normalizeCommand?.(prompt)).toBe(prompt);
    expect(ohMyPiRpcDialect.normalizeEvent(result)).toBe(result);
  });
});
