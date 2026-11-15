import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildFdArgumentPasses,
  buildFdFuzzyPattern,
  buildFdSubstringPattern,
  resolveQueryScope,
  type WorkspaceFileSearchOptions,
} from "../../src/host/file-search/fdArgs.js";

describe("fd arguments", () => {
  it("builds an escaped fuzzy query that matches full paths", () => {
    const pattern = buildFdFuzzyPattern("/workspace", "ss[c]/x");
    expect(pattern).toContain("s.*s.*\\[.*c.*\\].*[\\\\/].*x");
    expect(new RegExp(pattern, "i").test("/workspace/docs/ss[c]/x.ts")).toBe(true);
  });

  it("matches a contiguous query, by name or by path when it holds a slash", () => {
    const pattern = buildFdSubstringPattern("/workspace", "core/run[x]");
    expect(new RegExp(pattern, "i").test("/workspace/src/core/run[x].ts")).toBe(true);
    expect(new RegExp(pattern, "i").test("/workspace/src/core/r-u-n[x].ts")).toBe(false);

    const options: WorkspaceFileSearchOptions = { excludeRules: [], respectIgnoreFiles: true, followSymlinks: false };
    const byName = buildFdArgumentPasses({ baseDirectory: "/workspace", displayPrefix: "", query: "time.ts" }, options);
    expect(byName.exact).not.toContain("--full-path");
    expect(byName.exact?.at(-1)).toBe("time\\.ts");
    const byPath = buildFdArgumentPasses({ baseDirectory: "/workspace", displayPrefix: "", query: "core/run" }, options);
    expect(byPath.exact).toContain("--full-path");
    expect(buildFdArgumentPasses({ baseDirectory: "/workspace", displayPrefix: "", query: "" }, options).exact).toBeUndefined();
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

    const args = buildFdArgumentPasses({ baseDirectory: "/workspace", displayPrefix: "", query: "src" }, options).fuzzy;

    expect(args).toContain("500");
    expect(args).toContain("--no-ignore");
    expect(args).toContain("--follow");
    expect(args).toContain("dist/**");
    expect(args).not.toContain("**/*.js");
  });
});
