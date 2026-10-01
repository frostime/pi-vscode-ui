import { describe, expect, it } from "vitest";

import { ELAPSED_TIMER_TOOLS, isElapsedTimerTool } from "../../src/webview/features/conversation/toolElapsedTimers.js";

describe("elapsed timer tool list", () => {
  it("matches the listed shell and code tools case-insensitively", () => {
    expect(isElapsedTimerTool("bash")).toBe(true);
    expect(isElapsedTimerTool("Bash")).toBe(true);
    expect(isElapsedTimerTool("powershell")).toBe(true);
    expect(isElapsedTimerTool("CodeMode")).toBe(true);
  });

  it("leaves quick tools outside the list", () => {
    expect(isElapsedTimerTool("read")).toBe(false);
    expect(isElapsedTimerTool("edit")).toBe(false);
    expect(isElapsedTimerTool("write")).toBe(false);
  });

  it("does not match a name that merely contains a listed one", () => {
    expect(isElapsedTimerTool("bashful")).toBe(false);
  });

  it("ships with the shell and code tools enabled", () => {
    expect([...ELAPSED_TIMER_TOOLS].sort()).toEqual(["bash", "codemode", "powershell"]);
  });
});
