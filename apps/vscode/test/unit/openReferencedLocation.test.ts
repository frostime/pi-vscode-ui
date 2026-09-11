import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => {
  class Position {
    constructor(readonly line: number, readonly character: number) {}
  }

  class Selection {
    constructor(readonly anchor: Position, readonly active: Position) {}
  }

  class Range {
    constructor(readonly start: Position, readonly end: Position) {}
  }

  const document = {
    validatePosition: vi.fn((position: Position) => position),
    lineAt: vi.fn((line: number) => ({ range: { end: new Position(line, 12) } })),
  };
  const editor = {
    selection: undefined as Selection | undefined,
    revealRange: vi.fn(),
  };

  return {
    Position,
    Selection,
    Range,
    document,
    editor,
    Uri: {
      file: vi.fn((fsPath: string) => ({ fsPath })),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      fs: {
        stat: vi.fn(() => Promise.resolve({})),
      },
      openTextDocument: vi.fn(() => Promise.resolve(document)),
    },
    window: {
      showTextDocument: vi.fn(() => Promise.resolve(editor)),
    },
    TextEditorRevealType: {
      InCenterIfOutsideViewport: 1,
    },
  };
});

const searchMock = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock("vscode", () => ({
  Position: vscodeMock.Position,
  Selection: vscodeMock.Selection,
  Range: vscodeMock.Range,
  Uri: vscodeMock.Uri,
  workspace: vscodeMock.workspace,
  window: vscodeMock.window,
  TextEditorRevealType: vscodeMock.TextEditorRevealType,
}));

vi.mock("../../src/extension/fd/WorkspaceFileSearch.js", () => ({
  WorkspaceFileSearch: class {
    readonly search = searchMock.search;
  },
}));

const { openReferencedLocation } = await import(
  "../../src/extension/conversation/openReferencedLocation.js"
);

describe("openReferencedLocation", () => {
  beforeEach(() => {
    vscodeMock.Uri.file.mockClear();
    vscodeMock.workspace.fs.stat.mockClear();
    vscodeMock.workspace.openTextDocument.mockClear();
    vscodeMock.window.showTextDocument.mockClear();
    vscodeMock.document.validatePosition.mockClear();
    vscodeMock.document.lineAt.mockClear();
    vscodeMock.editor.revealRange.mockClear();
    vscodeMock.editor.selection = undefined;
    searchMock.search.mockReset();
  });

  it("resolves relative references from the active session working directory", async () => {
    const sessionCwd = resolve("worktrees", "feature");

    await openReferencedLocation({ path: "src/file.ts" }, sessionCwd);

    expect(vscodeMock.Uri.file).toHaveBeenCalledWith(resolve(sessionCwd, "src/file.ts"));
  });

  it("positions the editor at the one-based line and column", async () => {
    await openReferencedLocation({ path: "src/file.ts", line: 42, column: 5 }, resolve("workspace"));

    expect(vscodeMock.document.validatePosition).toHaveBeenCalledWith(
      expect.objectContaining({ line: 41, character: 4 }),
    );
    expect(vscodeMock.editor.selection?.anchor).toMatchObject({ line: 41, character: 4 });
    expect(vscodeMock.editor.revealRange).toHaveBeenCalledOnce();
  });

  it("selects complete lines for a line range", async () => {
    await openReferencedLocation({ path: "src/file.ts", line: 5, endLine: 10 }, resolve("workspace"));

    expect(vscodeMock.editor.selection?.anchor).toMatchObject({ line: 4, character: 0 });
    expect(vscodeMock.editor.selection?.active).toMatchObject({ line: 9, character: 12 });
    expect(vscodeMock.editor.revealRange).toHaveBeenCalledOnce();
  });

  it("does not consult the workspace fallback when the file exists", async () => {
    await openReferencedLocation({ path: "src/file.ts" }, resolve("workspace"));

    expect(searchMock.search).not.toHaveBeenCalled();
  });

  it("opens the best workspace match when the reference path is missing", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    searchMock.search.mockResolvedValue([{ path: "moved/file.ts", isDirectory: false, score: 1 }]);

    await openReferencedLocation({ path: "src/file.ts", line: 3 }, resolve("workspace"));

    expect(searchMock.search).toHaveBeenCalledWith(
      resolve("workspace"),
      "src/file.ts",
      1,
      expect.any(Set),
      expect.objectContaining({ excludeRules: [] }),
    );
    expect(vscodeMock.Uri.file).toHaveBeenLastCalledWith(resolve("workspace", "moved/file.ts"));
    expect(vscodeMock.editor.revealRange).toHaveBeenCalledOnce();
  });

  it("queries by basename for a stale absolute reference", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    searchMock.search.mockResolvedValue([]);

    const basePath = resolve("workspace");
    await openReferencedLocation({ path: resolve(basePath, "old/dir/file.ts") }, basePath);

    expect(searchMock.search).toHaveBeenCalledWith(
      basePath,
      "file.ts",
      1,
      expect.any(Set),
      expect.anything(),
    );
  });

  it("treats a directory match as no match", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    searchMock.search.mockResolvedValue([{ path: "moved/dir", isDirectory: true, score: 1 }]);
    vscodeMock.workspace.openTextDocument.mockRejectedValueOnce(new Error("Unable to resolve nonexistent file"));

    await expect(
      openReferencedLocation({ path: "src/file.ts" }, resolve("workspace")),
    ).rejects.toThrow("Unable to resolve nonexistent file");
  });

  it("surfaces the original open error when the fallback has no match", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    searchMock.search.mockResolvedValue([]);
    vscodeMock.workspace.openTextDocument.mockRejectedValueOnce(new Error("Unable to resolve nonexistent file"));

    await expect(
      openReferencedLocation({ path: "src/file.ts" }, resolve("workspace")),
    ).rejects.toThrow("Unable to resolve nonexistent file");
  });

  it("surfaces the original open error when the fallback search fails", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    searchMock.search.mockRejectedValue(new Error("fd not found"));
    vscodeMock.workspace.openTextDocument.mockRejectedValueOnce(new Error("Unable to resolve nonexistent file"));

    await expect(
      openReferencedLocation({ path: "src/file.ts" }, resolve("workspace")),
    ).rejects.toThrow("Unable to resolve nonexistent file");
  });
});
