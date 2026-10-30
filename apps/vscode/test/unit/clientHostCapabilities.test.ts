import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const native = vi.hoisted(() => {
  const editor: { current: unknown } = { current: undefined };
  return {
    stat: vi.fn(), openTextDocument: vi.fn(), showTextDocument: vi.fn(),
    showSaveDialog: vi.fn(), writeFile: vi.fn(), showInformationMessage: vi.fn(), editor,
  };
});
vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    fs: { stat: native.stat, writeFile: native.writeFile },
    openTextDocument: native.openTextDocument,
    asRelativePath: () => "src/synthetic.ts",
  },
  window: {
    get activeTextEditor() { return native.editor.current; },
    showTextDocument: native.showTextDocument,
    showSaveDialog: native.showSaveDialog,
    showInformationMessage: native.showInformationMessage,
  },
}));

import { createClientHost, type ClientHostInputs } from "../../src/extension/clientHost.js";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "@frostime/pi-client/shared/model/clientUiCapabilities";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";

function host() {
  // Only native system boundaries are fake. The product Host and its bindings below are real.
  const context = { workspaceState: {} } as vscode.ExtensionContext;
  const inputs = { logger: { contentsHeader: () => "Synthetic diagnostics" }, proxyCredentials: {} } as ClientHostInputs;
  return createClientHost(context, inputs);
}

beforeEach(() => { vi.clearAllMocks(); native.editor.current = undefined; });

describe("VS Code UI capability backing", () => {
  it("uses the same reference declaration as its renderer and opens a file through real native bindings", async () => {
    const client = host();
    expect(client.capabilities).toBe(VSCODE_CLIENT_UI_CAPABILITIES);
    expect(client.capabilities.openReferencedLocation).toBe(true);
    const file = join(tmpdir(), "frostpi-capability-reference.ts");
    const document = { uri: { fsPath: file } };
    native.stat.mockResolvedValue({});
    native.openTextDocument.mockResolvedValue(document);
    native.showTextDocument.mockResolvedValue({});
    await client.editor.openReferencedLocation!({ type: "openFile", path: file, bridgeVersion: BRIDGE_VERSION }, undefined);
    expect(native.openTextDocument).toHaveBeenCalledWith({ fsPath: file });
    expect(native.showTextDocument).toHaveBeenCalledWith(document, { preview: true });
  });

  it("backs editor mention support with selection/current-file capture rather than empty stubs", () => {
    const client = host();
    expect(client.capabilities.editorMentionSpecials).toBe(true);
    native.editor.current = {
      document: { uri: { scheme: "file", fsPath: "/synthetic/src/synthetic.ts" } },
      selection: { isEmpty: false, start: { line: 2 }, end: { line: 4 } },
    };
    expect(client.editor.captureActiveSelection!()).toBe("`src/synthetic.ts:3-5`");
    expect(client.editor.captureActiveFileReference!()).toBe("`src/synthetic.ts`");
    expect(client.editor.listEditorMentionSpecials!("")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "selection", insertText: "`src/synthetic.ts:3-5` " }),
      expect.objectContaining({ id: "current-file", insertText: "`src/synthetic.ts` " }),
    ]));
  });

  it("exports diagnostics through the real dialog/write binding, with redaction rather than a success stub", async () => {
    const client = host();
    expect(client.capabilities.exportDiagnostics).toBe(true);
    const target = { fsPath: "synthetic-diagnostics.txt" };
    native.showSaveDialog.mockResolvedValue(target);
    native.writeFile.mockResolvedValue(undefined);
    await client.exportDiagnostics!("Proxy: http://user:secret@localhost:7890");
    expect(native.writeFile).toHaveBeenCalledTimes(1);
    const [actualTarget, body] = native.writeFile.mock.calls[0] as [unknown, Buffer];
    expect(actualTarget).toBe(target);
    expect(body.toString("utf8")).toContain("Synthetic diagnostics");
    expect(body.toString("utf8")).not.toContain("secret");
  });
  // Editor tabs are backed by SessionWebviewCoordinator + dispatcher inputs, not ClientHost.editor.
  // Their actual open/reveal and draft handoff remain covered by those existing behavior suites.
});
