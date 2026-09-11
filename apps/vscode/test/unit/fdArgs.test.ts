import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildFdArguments,
  buildFdFuzzyPattern,
  resolveQueryScope,
  type WorkspaceFileSearchOptions,
} from "../../src/extension/fd/fdArgs.js";

describe("fd arguments", () => {
  it("builds an escaped fuzzy query that matches full paths", () => {
    const pattern = buildFdFuzzyPattern("/workspace", "ss[c]/x");
    expect(pattern).toContain("s.*s.*\\[.*c.*\\].*[\\\\/].*x");
    expect(new RegExp(pattern, "i").test("/workspace/docs/ss[c]/x.ts")).toBe(true);
  });

  it("scopes continued directory completion to that directory", () => {
    const cwd = resolve("/workspace");
    const srcDirectory = resolve(cwd, "src");
    const isDirectory = (path: string) => path === srcDirectory;

    expect(resolveQueryScope(cwd, "src/com", isDirectory)).toEqual({
      baseDirectory: srcDirectory,
      displayPrefix: "src/",
      query: "com",
    });
    expect(resolveQueryScope(cwd, "missing/com", isDirectory)).toEqual({
      baseDirectory: cwd,
      displayPrefix: "",
      query: "missing/com",
    });
  });

  it("maps ignore, symlink, and exclude controls to bounded fd arguments", () => {
    const options: WorkspaceFileSearchOptions = {
      excludeRules: [{ pattern: "dist/**" }, { pattern: "**/*.js", when: "$(basename).ts" }],
      respectIgnoreFiles: false,
      followSymlinks: true,
    };

    const args = buildFdArguments({ baseDirectory: "/workspace", displayPrefix: "", query: "src" }, options);

    expect(args).toContain("500");
    expect(args).toContain("--no-ignore");
    expect(args).toContain("--follow");
    expect(args).toContain("dist/**");
    expect(args).not.toContain("**/*.js");
  });
});
