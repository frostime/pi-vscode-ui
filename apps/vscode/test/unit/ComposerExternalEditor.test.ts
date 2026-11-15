import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => {
  class EventEmitter<T> {
    readonly listeners = new Set<(value: T) => void>();
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void {
      for (const listener of this.listeners) listener(value);
    }
    dispose(): void {
      this.listeners.clear();
    }
  }

  class TabInputText {
    constructor(readonly uri: { fsPath: string }) {}
  }

  type MockDocument = { uri: { fsPath: string }; getText(): string };
  const closeDocumentEmitter = new EventEmitter<MockDocument>();
  const changeTabsEmitter = new EventEmitter<{ closed: Array<{ input: unknown }> }>();
  const documents: MockDocument[] = [];

  return {
    TabInputText,
    closeDocumentEmitter,
    changeTabsEmitter,
    documents,
    reset() {
      documents.length = 0;
      closeDocumentEmitter.dispose();
      changeTabsEmitter.dispose();
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath, scheme: "file", toString: () => `file:${fsPath}` }),
    },
    workspace: {
      onDidCloseTextDocument: closeDocumentEmitter.event.bind(closeDocumentEmitter),
      get textDocuments() {
        return documents;
      },
      openTextDocument: vi.fn(async (uri: { fsPath: string }) => {
        const body = await readFile(uri.fsPath, "utf8");
        const document: MockDocument = {
          uri: { fsPath: uri.fsPath },
          getText: () => body,
        };
        documents.push(document);
        return document;
      }),
    },
    window: {
      showTextDocument: vi.fn(() => Promise.resolve(undefined)),
      tabGroups: {
        onDidChangeTabs: changeTabsEmitter.event.bind(changeTabsEmitter),
      },
    },
  };
});

vi.mock("vscode", () => ({
  TabInputText: vscodeMock.TabInputText,
  Uri: vscodeMock.Uri,
  workspace: vscodeMock.workspace,
  window: vscodeMock.window,
}));

const { ComposerExternalEditor } = await import("../../src/extension/composer/ComposerExternalEditor.js");

describe("ComposerExternalEditor", () => {
  beforeEach(() => {
    vscodeMock.reset();
    vscodeMock.workspace.openTextDocument.mockClear();
    vscodeMock.window.showTextDocument.mockClear();
  });

  it("writes a temp markdown file and applies disk contents when the tab closes", async () => {
    const applied: Array<{ sessionId: string; text: string }> = [];
    const editor = new ComposerExternalEditor((result) => applied.push(result));

    await expect(editor.open("session-1", "draft body")).resolves.toBe("opened");
    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledOnce();
    expect(vscodeMock.window.showTextDocument).toHaveBeenCalledOnce();

    const document = vscodeMock.documents[0]!;
    await writeFile(document.uri.fsPath, "edited body\n", "utf8");
    vscodeMock.changeTabsEmitter.fire({
      closed: [{ input: new vscodeMock.TabInputText({ fsPath: document.uri.fsPath }) }],
    });
    await vi.waitFor(() => expect(applied).toEqual([{ sessionId: "session-1", text: "edited body" }]));

    await expect(access(document.uri.fsPath)).rejects.toThrow();
    editor.dispose();
  });

  it("applies only once when both tab-close and document-close fire", async () => {
    const applied: Array<{ sessionId: string; text: string }> = [];
    const editor = new ComposerExternalEditor((result) => applied.push(result));

    await expect(editor.open("session-1", "draft")).resolves.toBe("opened");
    const document = vscodeMock.documents[0]!;
    await writeFile(document.uri.fsPath, "once\n", "utf8");

    vscodeMock.changeTabsEmitter.fire({
      closed: [{ input: new vscodeMock.TabInputText({ fsPath: document.uri.fsPath }) }],
    });
    vscodeMock.closeDocumentEmitter.fire(document);

    await vi.waitFor(() => expect(applied).toEqual([{ sessionId: "session-1", text: "once" }]));
    editor.dispose();
  });

  it("reveals the pending tab instead of opening a second buffer", async () => {
    const editor = new ComposerExternalEditor(vi.fn());

    await expect(editor.open("session-1", "first")).resolves.toBe("opened");
    const firstPath = vscodeMock.documents[0]!.uri.fsPath;
    await expect(editor.open("session-2", "second")).resolves.toBe("already-open");

    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledOnce();
    expect(vscodeMock.window.showTextDocument).toHaveBeenCalledTimes(2);

    editor.dispose();
    await expect(access(firstPath)).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("keeps the draft unreadable by other local accounts", async () => {
    const editor = new ComposerExternalEditor(vi.fn());
    // A permissive umask must not widen the draft: the modes are requested explicitly.
    const previousUmask = process.umask(0o000);
    try {
      await editor.open("session-1", "private prompt text");
    } finally {
      process.umask(previousUmask);
    }
    const fsPath = vscodeMock.documents[0]!.uri.fsPath;
    const directory = dirname(fsPath);

    expect((await stat(fsPath)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    // The draft sits alone in a directory created for it, not directly in the shared temp directory.
    expect(dirname(directory)).toBe(tmpdir());
    expect(await readdir(directory)).toEqual(["composer-draft.md"]);

    editor.dispose();
  });

  it("removes the private directory with the draft, on apply and on dispose", async () => {
    const applied: Array<{ sessionId: string; text: string }> = [];
    const editor = new ComposerExternalEditor((result) => applied.push(result));

    await editor.open("session-1", "first");
    const first = vscodeMock.documents[0]!;
    vscodeMock.closeDocumentEmitter.fire(first);
    await vi.waitFor(() => expect(applied).toHaveLength(1));
    await vi.waitFor(() => expect(access(dirname(first.uri.fsPath))).rejects.toThrow());

    vscodeMock.documents.length = 0;
    await editor.open("session-1", "second");
    const second = vscodeMock.documents[0]!;
    editor.dispose();
    await expect(access(dirname(second.uri.fsPath))).rejects.toThrow();
  });

  it("leaves nothing behind when the editor cannot open the draft", async () => {
    const editor = new ComposerExternalEditor(vi.fn());
    let attempted = "";
    vscodeMock.workspace.openTextDocument.mockImplementationOnce((uri: { fsPath: string }) => {
      attempted = uri.fsPath;
      return Promise.reject(new Error("editor unavailable"));
    });

    await expect(editor.open("session-1", "draft")).rejects.toThrow("editor unavailable");
    await expect(access(dirname(attempted))).rejects.toThrow();

    // A later attempt is not mistaken for an already-open draft.
    await expect(editor.open("session-1", "draft")).resolves.toBe("opened");
    editor.dispose();
  });
});
