import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as vscode from "vscode";

export interface ComposerEditorResult {
  sessionId: string;
  text: string;
}

/**
 * One-at-a-time temp markdown file for long-form Composer drafts (Pi external-editor shape).
 * Tab close applies on-disk contents: Save keeps edits, Don't Save keeps last saved/prefill text.
 */
export class ComposerExternalEditor implements vscode.Disposable {
  #pending: { sessionId: string; fsPath: string } | null = null;
  #applying = false;
  readonly #onApply: (result: ComposerEditorResult) => void;
  readonly #onAlreadyOpen: () => void;
  readonly #subscriptions: vscode.Disposable[] = [];

  constructor(onApply: (result: ComposerEditorResult) => void, onAlreadyOpen: () => void) {
    this.#onApply = onApply;
    this.#onAlreadyOpen = onAlreadyOpen;
    this.#subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        if (!this.#pending) return;
        for (const tab of event.closed) {
          const input = tab.input;
          if (input instanceof vscode.TabInputText && samePath(input.uri.fsPath, this.#pending.fsPath)) {
            void this.#applyPending();
            return;
          }
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!this.#pending || !samePath(document.uri.fsPath, this.#pending.fsPath)) return;
        void this.#applyPending();
      }),
    );
  }

  async open(sessionId: string, text: string): Promise<void> {
    if (this.#pending) {
      const pendingPath = this.#pending.fsPath;
      const open = vscode.workspace.textDocuments.find((document) => samePath(document.uri.fsPath, pendingPath));
      if (open) {
        await vscode.window.showTextDocument(open, { preview: false, preserveFocus: false });
        this.#onAlreadyOpen();
        return;
      }
      await this.#deleteQuietly(pendingPath);
      this.#pending = null;
    }

    const fsPath = resolve(join(tmpdir(), `frostpi-composer-${Date.now()}-${randomBytes(4).toString("hex")}.md`));
    await fs.writeFile(fsPath, text, "utf8");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    this.#pending = { sessionId, fsPath: resolve(document.uri.fsPath) };
    await vscode.window.showTextDocument(document, { preview: false });
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      try {
        unlinkSync(pending.fsPath);
      } catch {
        // Best-effort cleanup when the extension host tears down.
      }
    }
  }

  async #applyPending(): Promise<void> {
    const pending = this.#pending;
    if (!pending || this.#applying) return;
    this.#applying = true;
    this.#pending = null;
    try {
      // Yield so an in-flight Save can finish writing before we read disk.
      await sleep(0);
      const text = await readFileWithRetry(pending.fsPath);
      this.#onApply({ sessionId: pending.sessionId, text });
    } finally {
      this.#applying = false;
      await this.#deleteQuietly(pending.fsPath);
    }
  }

  async #deleteQuietly(fsPath: string): Promise<void> {
    await fs.unlink(fsPath).catch(() => undefined);
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function readFileWithRetry(fsPath: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return (await fs.readFile(fsPath, "utf8")).replace(/\n$/, "");
    } catch (error) {
      lastError = error;
      await sleep(15 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to read composer editor file: ${fsPath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDone) => setTimeout(resolveDone, ms));
}
