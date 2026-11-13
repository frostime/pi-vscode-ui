import { describe, expect, it } from "vitest";

import { runtimeCompatibilityProfile } from "../../src/core/configuration/runtimeCompatibility.js";
import { answersHostCommand, parseHostCommand, withHostCommands } from "../../src/core/sessions/hostCommands.js";

const pi = { capabilities: runtimeCompatibilityProfile("pi").capabilities, sessionTreeAdapter: true, sideQuestionAdapter: true };
const omp = { capabilities: runtimeCompatibilityProfile("oh-my-pi").capabilities, sessionTreeAdapter: true, sideQuestionAdapter: true };

describe("Host slash commands", () => {
  it("recognizes each command and normalizes the whitespace before its argument", () => {
    expect(parseHostCommand("  /clear  ")).toEqual({ name: "clear", argument: "" });
    expect(parseHostCommand("/rewind")).toEqual({ name: "rewind", argument: "" });
    expect(parseHostCommand("/compact")).toEqual({ name: "compact", argument: "" });
    expect(parseHostCommand("/compact focus on   the API ")).toEqual({ name: "compact", argument: "focus on   the API" });
    expect(parseHostCommand("/btw\twhy is this slow?\nand that?")).toEqual({ name: "btw", argument: "why is this slow?\nand that?" });
    expect(parseHostCommand("/btw")).toEqual({ name: "btw", argument: "" });
  });

  it("leaves everything else, including argument-taking look-alikes, to the runtime", () => {
    for (const text of ["/clear the cache", "/rewind 2", "/clearall", "/btw-notes hi", "/Clear", "clear", "say /clear", "/ clear", ""]) {
      expect(parseHostCommand(text), text).toBeNull();
    }
  });

  it("answers a command only when the runtime profile and the bundled adapter allow it", () => {
    expect((["compact", "clear", "rewind", "btw"] as const).map((name) => answersHostCommand(name, pi))).toEqual([true, true, true, true]);
    expect((["compact", "clear", "rewind", "btw"] as const).map((name) => answersHostCommand(name, omp))).toEqual([true, false, false, false]);
    expect(answersHostCommand("rewind", { ...pi, sessionTreeAdapter: false })).toBe(false);
    expect(answersHostCommand("btw", { ...pi, sideQuestionAdapter: false })).toBe(false);
    expect(answersHostCommand("clear", { ...pi, sessionTreeAdapter: false, sideQuestionAdapter: false })).toBe(true);
  });

  it("lists supported Host commands first and lets them shadow a same-named runtime command", () => {
    const runtimeCommands = [
      { name: "clear", description: "The user's own clear", source: "extension" },
      { name: "deploy", source: "prompt" },
    ];

    expect(withHostCommands(runtimeCommands, pi).map(({ name, source }) => `${name}:${source}`)).toEqual([
      "clear:frostpi", "rewind:frostpi", "btw:frostpi", "deploy:prompt",
    ]);
    // A runtime FrostPi cannot answer for keeps its own command untouched.
    expect(withHostCommands(runtimeCommands, omp)).toEqual(runtimeCommands);
  });
});
