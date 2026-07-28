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

vi.mock("vscode", () => ({
  Position: vscodeMock.Position,
  Selection: vscodeMock.Selection,
  Range: vscodeMock.Range,
  Uri: vscodeMock.Uri,
  workspace: vscodeMock.workspace,
  window: vscodeMock.window,
  TextEditorRevealType: vscodeMock.TextEditorRevealType,
}));

const { openReferencedLocation } = await import(
  "../../src/extension/conversation/openReferencedLocation.js"
);

describe("openReferencedLocation", () => {
  beforeEach(() => {
    vscodeMock.Uri.file.mockClear();
    vscodeMock.workspace.openTextDocument.mockClear();
    vscodeMock.window.showTextDocument.mockClear();
    vscodeMock.document.validatePosition.mockClear();
    vscodeMock.document.lineAt.mockClear();
    vscodeMock.editor.revealRange.mockClear();
    vscodeMock.editor.selection = undefined;
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
});
