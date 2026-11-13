import { rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as vscode from "vscode";

export interface ComposerEditorResult {
  sessionId: string;
  text: string;
}

export type ComposerExternalEditorOpenResult = "opened" | "already-open";

interface PendingDraft {
  sessionId: string;
  fsPath: string;
  /** Private directory that holds only this draft; removed together with it. */
  directory: string;
}

/**
 * One-at-a-time temp markdown file for long-form Composer drafts (Pi external-editor shape).
 * Tab close applies on-disk contents: Save keeps edits, Don't Save keeps last saved/prefill text.
 *
 * A draft is prompt text, and the system temp directory is shared with other local
 * accounts, so the file lives in its own owner-only directory and is itself owner-only.
 */
export class ComposerExternalEditor implements vscode.Disposable {
  #pending: PendingDraft | null = null;
  #applying = false;
  readonly #onApply: (result: ComposerEditorResult) => void;
  readonly #subscriptions: vscode.Disposable[] = [];

  constructor(onApply: (result: ComposerEditorResult) => void) {
    this.#onApply = onApply;
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

  async open(sessionId: string, text: string): Promise<ComposerExternalEditorOpenResult> {
    if (this.#pending) {
      const pendingPath = this.#pending.fsPath;
      const open = vscode.workspace.textDocuments.find((document) => samePath(document.uri.fsPath, pendingPath));
      if (open) {
        await vscode.window.showTextDocument(open, { preview: false, preserveFocus: false });
        return "already-open";
      }
      await this.#deleteQuietly(this.#pending.directory);
      this.#pending = null;
    }

    // mkdtemp gives an unpredictable name and mode 0700, so no other account can read
    // or pre-create the draft; "wx" additionally refuses any path that already exists.
    const directory = await fs.mkdtemp(join(tmpdir(), "frostpi-composer-"));
    let document: vscode.TextDocument;
    try {
      const fsPath = resolve(join(directory, "composer-draft.md"));
      await fs.writeFile(fsPath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
      document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    } catch (error) {
      // Nothing tracks the draft yet, so it would otherwise stay on disk.
      await this.#deleteQuietly(directory);
      throw error;
    }
    this.#pending = { sessionId, fsPath: resolve(document.uri.fsPath), directory };
    await vscode.window.showTextDocument(document, { preview: false });
    return "opened";
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      try {
        rmSync(pending.directory, { recursive: true, force: true });
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
      await this.#deleteQuietly(pending.directory);
    }
  }

  async #deleteQuietly(directory: string): Promise<void> {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
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
