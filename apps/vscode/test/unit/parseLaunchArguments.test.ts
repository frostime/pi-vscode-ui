import { describe, expect, it } from "vitest";

import { parseLaunchArguments } from "../../src/extension/sessions/parseLaunchArguments.js";

describe("parseLaunchArguments", () => {
  it("splits plain whitespace-separated arguments", () => {
    expect(parseLaunchArguments("--model sonnet --no-session")).toEqual(["--model", "sonnet", "--no-session"]);
  });

  it("collapses whitespace runs and trims the input", () => {
    expect(parseLaunchArguments("  a \t b  ")).toEqual(["a", "b"]);
  });

  it("keeps quoted whitespace as one argument and removes the quotes", () => {
    expect(parseLaunchArguments('--system-prompt "focus on tests"')).toEqual([
      "--system-prompt",
      "focus on tests",
    ]);
  });

  it("treats backslash as a literal character", () => {
    expect(parseLaunchArguments("--log-file \"D:\\x y.log\"")).toEqual(["--log-file", "D:\\x y.log"]);
  });

  it("keeps a quoted group spanning flag and value as one token", () => {
    expect(parseLaunchArguments('"--log-file D:\\x y.log"')).toEqual(["--log-file D:\\x y.log"]);
  });

  it("merges quoted segments with adjacent text", () => {
    expect(parseLaunchArguments('a"b c"d')).toEqual(["ab cd"]);
  });

  it("runs an unclosed quote to the end of the input without error", () => {
    expect(parseLaunchArguments('--prompt "never closed')).toEqual(["--prompt", "never closed"]);
  });

  it("preserves empty quoted tokens", () => {
    expect(parseLaunchArguments('a "" b')).toEqual(["a", "", "b"]);
  });

  it("returns no tokens for blank or empty input", () => {
    expect(parseLaunchArguments("")).toEqual([]);
    expect(parseLaunchArguments("   ")).toEqual([]);
  });

  it("preserves inputs made only of empty quoted tokens for the caller to classify", () => {
    expect(parseLaunchArguments('""  ""')).toEqual(["", ""]);
  });
});
