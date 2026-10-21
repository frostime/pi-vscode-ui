import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { canonicalPath, sameCanonicalPath } from "@frostime/pi-client/core/_shared/canonicalPath";

import type { DesktopProject } from "../shared/desktopBridge.js";

/**
 * Desktop's Project registry, injected into the shared client backend as its workspace service.
 *
 * Preview note: Projects live in memory for this technical preview. The durable config
 * location and the reopen-after-restart contract are still undecided by product, so no
 * disk schema is invented here.
 */
export class DesktopProjects {
  readonly #projects = new Map<string, DesktopProject>();
  readonly #listeners = new Set<() => void>();
  #selectedId: string | null = null;

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
      if (this.#selectedId === null) this.#selectedId = existing.id;
      return existing;
    }

    const project: DesktopProject = {
      id: randomUUID(),
      name: basename(canonical),
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
