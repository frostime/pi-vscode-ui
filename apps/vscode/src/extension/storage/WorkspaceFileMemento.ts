import * as vscode from "vscode";

import type { HostMemento } from "@frostime/pi-client/host";

const STATE_FILE = "frostpi-state.json";

interface MementoLogger {
  error(message: string, error?: unknown): void;
}

/**
 * Workspace state kept in a file under the extension's workspace storage, on the machine
 * that runs the Extension Host. VS Code keeps `workspaceState` in the window's own user
 * data, which over Remote SSH, WSL or a dev container is the local machine: the session
 * list then lived on whichever computer opened the remote folder, next to Pi's session
 * files on another. `context.storageUri` belongs to the Extension Host, so the list now
 * stays on the remote with those files.
 *
 * Reads are served from memory. A key not yet in the file falls back to `workspaceState`,
 * so a list saved there by an earlier version is read once and moves to the file on the
 * next save; nothing more is written to `workspaceState`. Writes are serialized and
 * replace the file through a temporary file, so a crash leaves the previous state.
 */
export class WorkspaceFileMemento implements HostMemento {
  readonly #file: vscode.Uri;
  readonly #fallback: HostMemento;
  readonly #logger: MementoLogger;
  readonly #values: Record<string, unknown>;
  #writes: Promise<void> = Promise.resolve();

  private constructor(file: vscode.Uri, fallback: HostMemento, logger: MementoLogger, values: Record<string, unknown>) {
    this.#file = file;
    this.#fallback = fallback;
    this.#logger = logger;
    this.#values = values;
  }

  /** Without workspace storage (no folder open) the fallback is used unchanged. */
  static async open(storageUri: vscode.Uri | undefined, fallback: HostMemento, logger: MementoLogger): Promise<HostMemento> {
    if (!storageUri) return fallback;
    const file = vscode.Uri.joinPath(storageUri, STATE_FILE);
    return new WorkspaceFileMemento(file, fallback, logger, await readState(file, logger));
  }

  get<T>(key: string): T | undefined {
    return Object.hasOwn(this.#values, key) ? this.#values[key] as T : this.#fallback.get<T>(key);
  }

  update<T>(key: string, value: T): Promise<void> {
    if (value === undefined) delete this.#values[key];
    else this.#values[key] = value;
    const content = new TextEncoder().encode(`${JSON.stringify(this.#values)}\n`);
    const write = this.#writes.catch(() => undefined).then(() => this.#write(content));
    this.#writes = write;
    return write;
  }

  async #write(content: Uint8Array): Promise<void> {
    const directory = vscode.Uri.joinPath(this.#file, "..");
    const temporary = vscode.Uri.joinPath(directory, `${STATE_FILE}.tmp`);
    try {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(temporary, content);
      await vscode.workspace.fs.rename(temporary, this.#file, { overwrite: true });
    } catch (error) {
      this.#logger.error("Failed to save FrostPi workspace state", error);
      throw error;
    }
  }
}

async function readState(file: vscode.Uri, logger: MementoLogger): Promise<Record<string, unknown>> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(file);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
      logger.error("Failed to read FrostPi workspace state; using the state VS Code kept", error);
    }
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return { ...parsed as Record<string, unknown> };
  } catch {
    // Reported below.
  }
  logger.error("FrostPi workspace state is not valid JSON; using the state VS Code kept until the next save");
  return {};
}
