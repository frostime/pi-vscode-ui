import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { DesktopSettingsValues } from "../../shared/desktopSettings.js";
import { validateDesktopSettings } from "./validateDesktopSettings.js";
import { MAX_JSON_BYTES, parseJsonObject, readJsonObject, writeFileAtomically } from "../storage/jsonFile.js";
import { DesktopSettingsError } from "./DesktopSettingsError.js";
const LOAD_ERROR = "Cannot read Desktop settings. Open settings.json, check its format, values, size (maximum 1 MiB), and permissions, then reload.";
const SAVE_ERROR = "Cannot save Desktop settings. Check the settings folder permissions and available space, then try again.";

export class DesktopSettingsStore {
  private currentValues: DesktopSettingsValues = {};
  private isFirstRun = false;
  private loadError: string | undefined;
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private constructor(readonly filePath: string) {}

  static async open(filePath: string): Promise<DesktopSettingsStore> {
    const store = new DesktopSettingsStore(filePath);
    await store.reload();
    return store;
  }

  get values(): DesktopSettingsValues { return structuredClone(this.currentValues); }
  get firstRun(): boolean { return this.isFirstRun; }
  get error(): string | undefined { return this.loadError; }

  reload(): Promise<void> {
    return this.enqueue(async () => {
      this.currentValues = {};
      this.isFirstRun = false;
      this.loadError = undefined;
      try {
        let values: DesktopSettingsValues;
        try {
          values = await readJsonObject(this.filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          // Windows can also report ENOENT when an ancestor is a file, not a directory.
          let parent = dirname(this.filePath);
          for (;;) {
            try {
              if (!(await stat(parent)).isDirectory()) throw new Error(LOAD_ERROR);
              break;
            } catch (parentError) {
              if ((parentError as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw parentError;
              parent = dirname(parent);
            }
          }
          this.isFirstRun = true;
          return;
        }
        if (validateDesktopSettings(values).length) throw new Error(LOAD_ERROR);
        this.currentValues = values;
      } catch {
        this.currentValues = {};
        this.loadError = LOAD_ERROR;
      } finally {
        this.emitChange();
      }
    });
  }

  replace(values: unknown): Promise<void> {
    // Capture input before waiting for preceding writes, so callers cannot mutate a queued save.
    let snapshot: unknown;
    try { snapshot = structuredClone(values); }
    catch { return Promise.reject(new DesktopSettingsError("Settings must contain only supported JSON values.")); }
    return this.enqueue(() => this.persist(snapshot));
  }

  update(key: string, value: unknown): Promise<void> {
    let snapshot: unknown;
    try { snapshot = structuredClone(value); }
    catch { return Promise.reject(new DesktopSettingsError("Settings must contain only supported JSON values.")); }
    return this.enqueue(async () => {
      const values = this.values;
      if (snapshot === undefined) delete values[key];
      else Object.defineProperty(values, key, { value: snapshot, enumerable: true, configurable: true, writable: true });
      await this.persist(values);
    });
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  private async persist(values: unknown): Promise<void> {
    if (this.loadError) throw new DesktopSettingsError("Fix settings.json and reload before saving Desktop settings.");
    const issues = validateDesktopSettings(values);
    if (issues.length) throw new DesktopSettingsError(issues.join(" "));
    let text: string;
    let savedValues: DesktopSettingsValues;
    try {
      text = `${JSON.stringify(values, null, 2)}\n`;
      savedValues = parseJsonObject(text);
      if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES || validateDesktopSettings(savedValues).length) throw new Error();
    } catch {
      throw new DesktopSettingsError("Settings must contain supported JSON values and fit within 1 MiB.");
    }

    try {
      await writeFileAtomically(this.filePath, text);
    } catch {
      throw new DesktopSettingsError(SAVE_ERROR);
    }
    this.currentValues = savedValues;
    this.isFirstRun = false;
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      // Observer failures cannot turn a committed write into a failed save.
      try { listener(); } catch { /* No settings or exception contents are logged. */ }
    }
  }
}
