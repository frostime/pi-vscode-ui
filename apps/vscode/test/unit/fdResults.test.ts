import { describe, expect, it } from "vitest";

import { parseFdOutput, rankFileCandidate } from "../../src/extension/fd/fdResults.js";

describe("fd result parsing", () => {
  it("parses NUL-delimited files and directories across path separators", () => {
    expect(parseFdOutput("src\\app.ts\0src\\features\\\0")).toEqual([
      { path: "src/app.ts", isDirectory: false },
      { path: "src/features", isDirectory: true },
    ]);
  });
});

describe("workspace file ranking", () => {
  it("prioritizes exact names, prefixes, and boosted paths", () => {
    const exact = rankFileCandidate("src/SessionRuntime.ts", "sessionruntime.ts");
    const prefix = rankFileCandidate("src/SessionRegistry.ts", "session");
    const fuzzy = rankFileCandidate("docs/session-lifecycle.SPEC.md", "sslc");
    expect(exact?.score).toBeGreaterThan(prefix?.score ?? 0);
    expect(prefix?.score).toBeGreaterThan(fuzzy?.score ?? 0);

    const normal = rankFileCandidate("src/a.ts", "a");
    const boosted = rankFileCandidate("src/a.ts", "a", new Set(["src/a.ts"]));
    expect(boosted?.score).toBeGreaterThan(normal?.score ?? 0);
  });

  it("rejects candidates that do not contain the query in order", () => {
    expect(rankFileCandidate("src/session.ts", "xyz")).toBeUndefined();
  });
});
