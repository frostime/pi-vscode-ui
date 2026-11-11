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
    commands: {
      executeCommand: vi.fn(() => Promise.resolve()),
    },
    TextEditorRevealType: {
      InCenterIfOutsideViewport: 1,
    },
  };
});

const fallbackMock = vi.hoisted(() => ({
  findWorkspaceFile: vi.fn(),
}));

vi.mock("vscode", () => ({
  Position: vscodeMock.Position,
  Selection: vscodeMock.Selection,
  Range: vscodeMock.Range,
  Uri: vscodeMock.Uri,
  workspace: vscodeMock.workspace,
  window: vscodeMock.window,
  commands: vscodeMock.commands,
  TextEditorRevealType: vscodeMock.TextEditorRevealType,
}));

vi.mock("@frostime/pi-client/host/file-search/fallbackFileSearch", () => ({
  findWorkspaceFile: fallbackMock.findWorkspaceFile,
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
    vscodeMock.commands.executeCommand.mockClear();
    vscodeMock.document.validatePosition.mockClear();
    vscodeMock.document.lineAt.mockClear();
    vscodeMock.editor.revealRange.mockClear();
    vscodeMock.editor.selection = undefined;
    fallbackMock.findWorkspaceFile.mockReset();
  });

  it("resolves relative references from the active session working directory", async () => {
    const sessionCwd = resolve("worktrees", "feature");

    await openReferencedLocation({ path: "src/file.ts" }, sessionCwd);

    expect(vscodeMock.Uri.file).toHaveBeenCalledWith(resolve(sessionCwd, "src/file.ts"));
  });

  it("falls back to the default viewer for binary files like png/pdf", async () => {
    vscodeMock.workspace.openTextDocument.mockRejectedValueOnce(
      new Error("File seems to be binary and cannot be opened as text"),
    );

    await openReferencedLocation({ path: "assets/diagram.png", line: 1 }, resolve("workspace"));

    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.open",
      expect.objectContaining({ fsPath: resolve("workspace", "assets/diagram.png") }),
      { preview: true },
    );
    expect(vscodeMock.window.showTextDocument).not.toHaveBeenCalled();
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

    expect(fallbackMock.findWorkspaceFile).not.toHaveBeenCalled();
  });

  it("opens the best workspace match when the reference path is missing", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    fallbackMock.findWorkspaceFile.mockResolvedValue(resolve("workspace", "moved/file.ts"));

    await openReferencedLocation({ path: "src/file.ts", line: 3 }, resolve("workspace"));

    expect(fallbackMock.findWorkspaceFile).toHaveBeenCalledWith("src/file.ts", resolve("workspace"));
    expect(vscodeMock.Uri.file).toHaveBeenLastCalledWith(resolve("workspace", "moved/file.ts"));
    expect(vscodeMock.editor.revealRange).toHaveBeenCalledOnce();
  });

  it("surfaces the original open error when the fallback has no match", async () => {
    vscodeMock.workspace.fs.stat.mockRejectedValueOnce(new Error("ENOENT"));
    fallbackMock.findWorkspaceFile.mockResolvedValue(undefined);
    vscodeMock.workspace.openTextDocument.mockRejectedValueOnce(new Error("Unable to resolve nonexistent file"));

    await expect(
      openReferencedLocation({ path: "src/file.ts" }, resolve("workspace")),
    ).rejects.toThrow("Unable to resolve nonexistent file");
  });
});
