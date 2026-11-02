import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { canonicalPath, sameCanonicalPath } from "@frostime/pi-client/core/_shared/canonicalPath";

import type { DesktopProject, DesktopProjectsView } from "../shared/desktopBridge.js";

/**
 * Desktop's Project registry, injected into the shared client backend as its workspace service.
 * Startup restores validated Project metadata; persistence belongs to the caller.
 */
export class DesktopProjects {
  readonly #projects = new Map<string, DesktopProject>();
  readonly #listeners = new Set<() => void>();
  #selectedId: string | null = null;

  /** Restores the complete validated startup view, retaining metadata even for unavailable directories. */
  async restore(view: DesktopProjectsView): Promise<void> {
    const restored = new Map<string, DesktopProject>();
    let selectedId: string | null = null;
    for (const saved of view.projects) {
      const cwd = await canonicalPath(saved.cwd);
      const existing = [...restored.values()].find((project) => sameCanonicalPath(project.cwd, cwd));
      const project = existing ?? { ...saved, cwd };
      if (!existing) restored.set(project.id, project);
      if (saved.id === view.activeProjectId) selectedId = project.id;
    }

    this.#projects.clear();
    for (const [id, project] of restored) this.#projects.set(id, project);
    this.#selectedId = selectedId;
    this.#emitChange();
  }

  /** Validates, canonicalizes, and registers a directory. Duplicate paths return the existing Project unchanged. */
  async addProject(rawCwd: string): Promise<DesktopProject> {
    if (!rawCwd?.trim()) throw new Error("Choose a directory to add.");
    const canonical = await canonicalPath(rawCwd);
    let directory = false;
    try {
      directory = (await stat(canonical)).isDirectory();
    } catch {
      directory = false;
    }
    if (!directory) throw new Error(`"${rawCwd}" is not an existing directory.`);

    const existing = [...this.#projects.values()].find((project) => sameCanonicalPath(project.cwd, canonical));
    if (existing) {
      // Re-adding an already registered directory (possibly alias-spelled) must not create a second Project.
      if (this.#selectedId === null) {
        this.#selectedId = existing.id;
        this.#emitChange();
      }
      return existing;
    }

    const directoryName = basename(canonical);
    const project: DesktopProject = {
      id: randomUUID(),
      name: directoryName.trim() ? directoryName : canonical,
      cwd: canonical,
    };
    this.#projects.set(project.id, project);
    // The first registered Project is the initial explicit anchor; later selection stays explicit.
    if (this.#selectedId === null) this.#selectedId = project.id;
    this.#emitChange();
    return project;
  }

  /** Switches the explicit New/Resume anchor. Registered roots never change with the anchor. */
  selectProject(id: string | null): void {
    if (id === this.#selectedId) return;
    if (id !== null && !this.#projects.has(id)) throw new Error(`Unknown FrostPi Project: ${id}`);
    this.#selectedId = id;
    this.#emitChange();
  }

  /** Unregisters metadata only; the caller must close owned Sessions before removing their root. */
  removeProject(id: string): void {
    if (!this.#projects.delete(id)) throw new Error(`Unknown FrostPi Project: ${id}`);
    if (this.#selectedId === id) this.#selectedId = null;
    this.#emitChange();
  }

  /**
   * Reorders only the Map's own order. `index` is the target position after the moved Project is removed,
   * and an out-of-range index is an error rather than a clamp.
   */
  moveProject(id: string, index: number): void {
    const entries = [...this.#projects.entries()];
    const current = entries.findIndex(([candidate]) => candidate === id);
    if (current < 0) throw new Error(`Unknown FrostPi Project: ${id}`);
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      throw new Error(`Invalid Project position: ${String(index)}`);
    }
    if (current === index) return;
    entries.splice(index, 0, ...entries.splice(current, 1));
    this.#projects.clear();
    for (const [key, project] of entries) this.#projects.set(key, project);
    this.#emitChange();
  }

  get selected(): DesktopProject | null {
    return this.#selectedId ? this.#projects.get(this.#selectedId) ?? null : null;
  }

  list(): readonly DesktopProject[] {
    return [...this.#projects.values()];
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emitChange(): void {
    for (const listener of this.#listeners) listener();
  }
}
