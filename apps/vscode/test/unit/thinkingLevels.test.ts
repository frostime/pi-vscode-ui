import { describe, expect, it } from "vitest";

import { getSupportedThinkingLevels, normalizeThinkingLevel } from "$ui/features/models/thinkingLevels.js";

describe("thinking level compatibility", () => {
  it("disables configurable thinking for non-reasoning models", () => {
    expect(getSupportedThinkingLevels({ provider: "p", id: "m", reasoning: false }).map((item) => item.level)).toEqual(["off"]);
  });

  it("uses Pi's standard levels and keeps extended levels opt-in", () => {
    expect(getSupportedThinkingLevels({ provider: "p", id: "m", reasoning: true }).map((item) => item.level)).toEqual([
      "off", "minimal", "low", "medium", "high",
    ]);
  });

  it("respects sparse and null thinkingLevelMap entries", () => {
    const model = {
      provider: "p",
      id: "m",
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
    };
    expect(getSupportedThinkingLevels(model).map((item) => item.level)).toEqual(["high", "max"]);
    expect(normalizeThinkingLevel(model, "medium")).toBe("max");
  });
});
