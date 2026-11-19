import { describe, expect, it } from "vitest";

import { runtimeCompatibilityProfile } from "../../src/core/configuration/runtimeCompatibility.js";
import { answersHostCommand, parseHostCommand, withHostCommands } from "../../src/core/sessions/hostCommands.js";

const pi = { capabilities: runtimeCompatibilityProfile("pi").capabilities, sessionTreeAdapter: true };
const omp = { capabilities: runtimeCompatibilityProfile("oh-my-pi").capabilities, sessionTreeAdapter: true };

describe("Host slash commands", () => {
  it("recognizes each command and normalizes the whitespace before its argument", () => {
    expect(parseHostCommand("  /new  ")).toEqual({ name: "new", argument: "" });
    expect(parseHostCommand("/compact")).toEqual({ name: "compact", argument: "" });
    expect(parseHostCommand("/compact focus on   the API ")).toEqual({ name: "compact", argument: "focus on   the API" });
    expect(parseHostCommand("/reload")).toEqual({ name: "reload", argument: "" });
    expect(parseHostCommand("/name  Parser work")).toEqual({ name: "name", argument: "Parser work" });
    expect(parseHostCommand("/alias")).toEqual({ name: "alias", argument: "" });
  });

  it("leaves everything else, including argument-taking look-alikes, to the runtime", () => {
    for (const text of ["/new feature branch", "/rewind", "/rewind 2", "/reload all", "/names", "/aliases x", "/newest", "/btw-notes hi", "/New", "new", "say /new", "/ new", "/clear", ""]) {
      expect(parseHostCommand(text), text).toBeNull();
    }
  });

  it("answers a command only when the runtime profile and the bundled adapter allow it", () => {
    const names = ["compact", "name", "alias", "new", "reload"] as const;
    expect(names.map((name) => answersHostCommand(name, pi))).toEqual([true, true, true, true, true]);
    // Renaming uses a plain request every runtime has; the rest need Pi or its adapter.
    expect(names.map((name) => answersHostCommand(name, omp))).toEqual([true, true, true, false, false]);
    expect(answersHostCommand("reload", { ...pi, sessionTreeAdapter: false })).toBe(false);
    expect(answersHostCommand("new", { ...pi, sessionTreeAdapter: false })).toBe(true);
  });

  it("lists supported Host commands first and lets them shadow a same-named runtime command", () => {
    const runtimeCommands = [
      { name: "new", description: "The user's own new", source: "extension" },
      { name: "deploy", source: "prompt" },
    ];

    expect(withHostCommands(runtimeCommands, pi).map(({ name, source }) => `${name}:${source}`)).toEqual([
      "new:frostpi", "reload:frostpi", "name:frostpi", "alias:frostpi", "deploy:prompt",
    ]);
    // A runtime FrostPi cannot answer for keeps its own commands, beside the ones every runtime gets.
    expect(withHostCommands(runtimeCommands, omp).map(({ name }) => name)).toEqual(["name", "alias", "new", "deploy"]);
  });
});
