import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { findWorkspaceFile } from "../../src/host/file-search/fallbackFileSearch.js";
import type { WorkspaceFileSearch } from "../../src/host/file-search/WorkspaceFileSearch.js";
import type { WorkspaceFileCandidateView } from "../../src/shared/model/workspaceFileModel.js";

function candidate(path: string, isDirectory = false): WorkspaceFileCandidateView {
  return { path, name: path.split("/").at(-1)!, directory: path.split("/").slice(0, -1).join("/"), score: 1, isDirectory };
}

function searcher(result: readonly WorkspaceFileCandidateView[] | Error) {
  const search = vi.fn(async () =>
    result instanceof Error ? Promise.reject(result) : result);
  return { search } as unknown as Pick<WorkspaceFileSearch, "search"> & { search: typeof search };
}

const base = resolve("workspace");

describe("workspace file fallback lookup", () => {
  it("queries the workspace with the reference as written", async () => {
    const search = searcher([candidate("src/moved/file.ts")]);
    await expect(findWorkspaceFile("src/file.ts", base, search)).resolves.toBe(resolve(base, "src/moved/file.ts"));
    expect(search.search).toHaveBeenCalledWith(base, "src/file.ts", 1, expect.any(Set), expect.objectContaining({ excludeRules: [], followSymlinks: false }));
  });

  it("queries by basename for a stale absolute reference", async () => {
    const search = searcher([]);
    await findWorkspaceFile(resolve("/other/machine/src/file.ts"), base, search);
    expect(search.search).toHaveBeenCalledWith(base, "file.ts", 1, expect.anything(), expect.anything());
  });

  it("does not search without a base directory", async () => {
    const search = searcher([candidate("src/file.ts")]);
    await expect(findWorkspaceFile("src/file.ts", undefined, search)).resolves.toBeUndefined();
    expect(search.search).not.toHaveBeenCalled();
  });

  it("ignores a directory match", async () => {
    const search = searcher([candidate("src/file.ts", true)]);
    await expect(findWorkspaceFile("src/file.ts", base, search)).resolves.toBeUndefined();
  });

  it("treats a failed search as no match", async () => {
    const search = searcher(new Error("fd not found"));
    await expect(findWorkspaceFile("src/file.ts", base, search)).resolves.toBeUndefined();
  });
});
