import { stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { HostMemento } from "@frostime/pi-client/host";
import type { DesktopProjectsView } from "../../shared/desktopBridge.js";
import { MAX_JSON_BYTES, parseJsonObject, readJsonObject, writeFileAtomically } from "./jsonFile.js";

const LOAD_ERROR = "Cannot read Desktop state. Check state.json format, version, size (maximum 1 MiB), and permissions, then restart.";
const SAVE_ERROR = "Cannot save Desktop state. Check the state folder permissions and available space, then try again.";
const VALUE_ERROR = "Desktop state must contain valid project metadata and JSON values within 1 MiB.";

interface DesktopState extends DesktopProjectsView {
  version: 1;
  workspaceState: Record<string, unknown>;
}

/** The mutation reached desired memory; a later file flush can retry it. */
export class DesktopStateWriteError extends Error {}

/** Owns desired metadata independently of the last successful disk snapshot. */
export class DesktopStateStore implements HostMemento {
  private state: DesktopState = { version: 1, projects: [], activeProjectId: null, workspaceState: {} };
  private currentError: string | undefined;
  private writeBlocked = false;
  private revision = 0;
  private persistedRevision = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private constructor(readonly filePath: string) {}

  static async open(filePath: string): Promise<DesktopStateStore> {
    const store = new DesktopStateStore(filePath);
    try {
      let value: Record<string, unknown>;
      try {
        value = await readJsonObject(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // Windows can report ENOENT when an ancestor is a file rather than a directory.
        let parent = dirname(filePath);
        for (;;) {
          try {
            if (!(await stat(parent)).isDirectory()) throw new Error(LOAD_ERROR);
            return store;
          } catch (parentError) {
            if ((parentError as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw parentError;
            parent = dirname(parent);
          }
        }
      }
      if (!isDesktopState(value)) throw new Error(LOAD_ERROR);
      store.state = value;
    } catch {
      store.writeBlocked = true;
      store.currentError = LOAD_ERROR;
    }
    return store;
  }

  get projects(): DesktopProjectsView {
    return structuredClone({ projects: this.state.projects, activeProjectId: this.state.activeProjectId });
  }

  get error(): string | undefined { return this.currentError; }

  get<T>(key: string): T | undefined {
    return Object.hasOwn(this.state.workspaceState, key)
      ? structuredClone(this.state.workspaceState[key]) as T
      : undefined;
  }

  update<T>(key: string, value: T): Promise<void> {
    try {
      const workspaceState = { ...this.state.workspaceState };
      if (value === undefined) delete workspaceState[key];
      else Object.defineProperty(workspaceState, key, { value, enumerable: true, configurable: true, writable: true });
      return this.accept({ ...this.state, workspaceState });
    } catch {
      return Promise.reject(new Error(this.writeBlocked ? LOAD_ERROR : VALUE_ERROR));
    }
  }

  saveProjects(view: DesktopProjectsView): Promise<void> {
    try {
      // Only persistent fields enter the file, even if the UI view gains transient fields.
      const projects = view.projects.map(({ id, name, cwd }) => ({ id, name, cwd }));
      return this.accept({ ...this.state, projects, activeProjectId: view.activeProjectId });
    } catch {
      return Promise.reject(new Error(this.writeBlocked ? LOAD_ERROR : VALUE_ERROR));
    }
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.writeBlocked) throw new Error(LOAD_ERROR);
    // A failed final write remains dirty. Closing gets one retry, not a retry loop.
    if (this.persistedRevision !== this.revision) {
      await this.enqueueWrite(this.serialize(this.state), this.revision);
    }
    if (this.currentError) throw new Error(this.currentError);
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private accept(candidate: DesktopState): Promise<void> {
    if (this.writeBlocked) throw new Error(LOAD_ERROR);
    const text = this.serialize(candidate);
    const snapshot: unknown = parseJsonObject(text);
    if (!isDesktopState(snapshot)) throw new Error(VALUE_ERROR);
    this.state = snapshot;
    this.revision++;
    return this.enqueueWrite(text, this.revision);
  }

  private serialize(value: DesktopState): string {
    if (!isDesktopState(value)) throw new Error(VALUE_ERROR);
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error(VALUE_ERROR);
    return text;
  }

  private enqueueWrite(text: string, revision: number): Promise<void> {
    const result = this.pending.then(async () => {
      try {
        await writeFileAtomically(this.filePath, text);
      } catch {
        this.setError(SAVE_ERROR);
        throw new DesktopStateWriteError(SAVE_ERROR);
      }
      this.persistedRevision = revision;
      this.setError(undefined);
    });
    // Attach immediately: an ignored caller promise must not poison the queue.
    this.pending = result.catch(() => {});
    return result;
  }

  private setError(error: string | undefined): void {
    if (this.currentError === error) return;
    this.currentError = error;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers cannot change persistence outcomes. */ }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates the envelope only; SessionPersistence owns Memento value interpretation. */
function isDesktopState(value: unknown): value is DesktopState {
  if (!isObject(value) || Object.keys(value).length !== 4
    || !Object.hasOwn(value, "version") || value.version !== 1
    || !Object.hasOwn(value, "projects") || !Array.isArray(value.projects)
    || !Object.hasOwn(value, "activeProjectId")
    || !Object.hasOwn(value, "workspaceState") || !isObject(value.workspaceState)) return false;

  const ids = new Set<string>();
  for (const project of value.projects) {
    if (!isObject(project) || Object.keys(project).length !== 3
      || typeof project.id !== "string" || !project.id.trim()
      || typeof project.name !== "string" || !project.name.trim()
      || typeof project.cwd !== "string" || !isAbsolute(project.cwd)
      || ids.has(project.id)) return false;
    ids.add(project.id);
  }
  return value.activeProjectId === null
    || (typeof value.activeProjectId === "string" && ids.has(value.activeProjectId));
}
