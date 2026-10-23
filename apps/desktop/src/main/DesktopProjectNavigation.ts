import { AsyncLocalStorage } from "node:async_hooks";
import { sameCanonicalPath } from "@frostime/pi-client/core/_shared/canonicalPath";
import type { HostMemento, SessionRegistry } from "@frostime/pi-client/host";
import { SessionPersistence } from "@frostime/pi-client/host/sessions/SessionPersistence";
import { DESKTOP_SIDEBAR_WIDTH, type DesktopProjectNavigationView, type DesktopSidebarLayout } from "../shared/desktopBridge.js";
import type { DesktopProjects } from "./desktopProjects.js";

const STORAGE_KEY = "frostpi.desktop.navigation.v1";
const DEFAULT_SIDEBAR: DesktopSidebarLayout = { hidden: false, width: DESKTOP_SIDEBAR_WIDTH.default };

interface NavigationState {
  version: 1;
  sessionProjects: Record<string, string>;
  lastSessions: Record<string, string>;
  sidebar: DesktopSidebarLayout;
}

interface NavigationInputs {
  projects: DesktopProjects;
  registry: SessionRegistry;
  storage: HostMemento;
  publish(): void;
  reportError(error: unknown): void;
}

/** Desktop grouping and navigation only. Registry still owns every Session and process. */
export class DesktopProjectNavigation {
  readonly #inputs: NavigationInputs;
  readonly #owners = new Map<string, string>();
  readonly #last = new Map<string, string>();
  readonly #scope = new AsyncLocalStorage<string>();
  readonly #persistence: SessionPersistence;
  readonly #restored: boolean;
  #sidebar: DesktopSidebarLayout;
  #selectionRevision = 0;
  #saved = "";
  #saveFailure: unknown;
  #pending: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(inputs: NavigationInputs) {
    this.#inputs = inputs;
    this.#persistence = new SessionPersistence(inputs.storage);
    const stored = inputs.storage.get<unknown>(STORAGE_KEY);
    this.#restored = isNavigationState(stored);
    if (isNavigationState(stored)) {
      for (const [id, project] of Object.entries(stored.sessionProjects)) this.#owners.set(id, project);
      for (const [project, id] of Object.entries(stored.lastSessions)) this.#last.set(project, id);
      this.#sidebar = { ...stored.sidebar };
    } else this.#sidebar = { ...DEFAULT_SIDEBAR };
  }

  async initialize({ explicitProjectSelection = false }: { explicitProjectSelection?: boolean } = {}): Promise<void> {
    const { projects, registry } = this.#inputs;
    const roots = projects.list();
    const fallback = projects.selected?.id ?? roots[0]?.id;
    for (const session of registry.snapshot().sessions) {
      if (roots.some((project) => project.id === this.#owners.get(session.id))) continue;
      // Legacy records had no Project owner. Exact roots win; otherwise retain
      // worktree/unmatched entries under the saved anchor instead of losing them.
      const owner = roots.find((project) => sameCanonicalPath(project.cwd, session.cwd))?.id ?? fallback;
      if (owner) this.#owners.set(session.id, owner);
    }
    this.#prune();
    const active = registry.activeSessionId;
    const owner = active ? this.#owners.get(active) : undefined;
    if (active && owner) {
      this.#last.set(owner, active);
      // The first migration follows the actual saved conversation, not the old
      // independent New/Resume anchor. Later starts restore the chosen Project.
      if (!this.#restored && !explicitProjectSelection) projects.selectProject(owner);
      else if (owner !== projects.selected?.id) await registry.clearActiveSession();
    }
    this.#inputs.publish();
    void this.#save();
  }

  get view(): DesktopProjectNavigationView {
    const activity: DesktopProjectNavigationView["activity"] = {};
    for (const project of this.#inputs.projects.list()) activity[project.id] = { total: 0, running: 0, waitingSessionIds: [] };
    for (const session of this.#inputs.registry.snapshot().sessions) {
      const owner = this.#owners.get(session.id);
      const summary = owner ? activity[owner] : undefined;
      if (!summary) continue;
      summary.total++;
      if (session.status === "running") summary.running++;
      if (session.requiresUserInput) summary.waitingSessionIds.push(session.id);
    }
    return { sidebar: { ...this.#sidebar }, sessionProjects: Object.fromEntries(this.#owners), activity };
  }

  async selectProject(projectId: string, sessionId?: string): Promise<void> {
    if (this.#disposed) return;
    const { projects, registry } = this.#inputs;
    if (!projects.list().some((project) => project.id === projectId)) throw new Error("This Desktop Project is no longer available.");
    if (sessionId && (this.#owners.get(sessionId) !== projectId || !registry.hasSession(sessionId))) throw new Error("This session is no longer in the selected Project.");
    const active = registry.activeSessionId;
    if (projects.selected?.id === projectId && active && this.#owners.get(active) === projectId && (!sessionId || sessionId === active)) return;
    const revision = ++this.#selectionRevision;
    this.#rememberActive();
    // A real null foreground keeps shared bridge authorization and the empty
    // Project screen honest; no old conversation is hidden behind a fake snapshot.
    await registry.clearActiveSession();
    if (this.#disposed || revision !== this.#selectionRevision) return;
    projects.selectProject(projectId);
    const target = sessionId ?? this.#last.get(projectId)
      ?? registry.snapshot().sessions.find((session) => this.#owners.get(session.id) === projectId)?.id;
    this.#inputs.publish();
    if (target) await registry.activateSession(target);
    this.refresh();
  }

  async activateSession(sessionId: string): Promise<void> {
    const owner = this.#owners.get(sessionId);
    if (!owner || !this.#inputs.registry.hasSession(sessionId)) throw new Error("This FrostPi Session no longer exists.");
    await this.selectProject(owner, sessionId);
  }

  run(work: () => Promise<string | undefined>): Promise<string | undefined> {
    const projectId = this.#inputs.projects.selected?.id;
    if (!projectId) return work();
    this.#rememberActive();
    return this.#scope.run(projectId, async () => {
      try {
        const id = await work();
        if (!this.#disposed && id) this.#claim(id, projectId);
        return id;
      } finally { this.refresh(); }
    });
  }

  /** Registry names the opened identity while its New/Resume action scope is still known. */
  sessionOpened(sessionId: string, sourceSessionId?: string): void {
    if (this.#disposed) return;
    const owner = sourceSessionId ? this.#owners.get(sourceSessionId)
      : this.#scope.getStore() ?? this.#inputs.projects.selected?.id;
    if (!owner) return;
    if (sourceSessionId) {
      this.#owners.set(sessionId, owner);
      if (this.#inputs.registry.activeSessionId === sessionId) this.#last.set(owner, sessionId);
    } else this.#claim(sessionId, owner);
    this.refresh();
  }

  refresh(): void {
    if (this.#disposed) return;
    this.#prune();
    const { registry, projects } = this.#inputs;
    const active = registry.activeSessionId;
    if (active && this.#owners.get(active) !== projects.selected?.id) {
      // A slow New/Resume may finish after the user changed Projects. Keep its
      // Runtime in the originating Project, not in the newly foregrounded chat.
      const revision = this.#selectionRevision;
      const selected = projects.selected?.id;
      const last = selected ? this.#last.get(selected) : undefined;
      void registry.clearActiveSession().then(async () => {
        if (this.#disposed || revision !== this.#selectionRevision || !last || !registry.hasSession(last)) return;
        await registry.activateSession(last);
      }).catch((error: unknown) => this.#inputs.reportError(error));
    } else this.#rememberActive();
    this.#inputs.publish();
    void this.#save();
  }

  async setSidebar(value: unknown): Promise<void> {
    if (!isSidebar(value)) throw new Error("Invalid Desktop sidebar layout.");
    this.#sidebar = { hidden: value.hidden, width: Math.round(value.width) };
    this.#inputs.publish();
    await this.#save();
  }

  async flush(): Promise<void> {
    // Shared SessionPersistence, not Desktop inference, decides which identities
    // survive restart. Call after Registry has drained its metadata writes.
    await this.#pending;
    if (this.#saveFailure !== undefined) this.#saved = "";
    await this.#save();
    await this.#pending;
  }

  dispose(): void { this.#disposed = true; this.#selectionRevision++; }

  #rememberActive(): void {
    const { registry, projects } = this.#inputs;
    const id = registry.activeSessionId;
    if (!id) return;
    const owner = this.#owners.get(id);
    if (owner === projects.selected?.id && owner) {
      this.#last.set(owner, id);
      registry.retainProvisionalSession(id);
    }
  }

  #claim(id: string, project: string): void {
    if (!this.#inputs.projects.list().some((candidate) => candidate.id === project)) return;
    const previous = this.#owners.get(id);
    if (previous && previous !== project && this.#last.get(previous) === id) this.#last.delete(previous);
    this.#owners.set(id, project);
    this.#last.set(project, id);
  }

  #prune(): void {
    const projects = new Set(this.#inputs.projects.list().map((project) => project.id));
    for (const [id, owner] of this.#owners) {
      if (!projects.has(owner) || !this.#inputs.registry.hasSession(id)) this.#owners.delete(id);
    }
    for (const [owner, id] of this.#last) if (this.#owners.get(id) !== owner) this.#last.delete(owner);
  }

  #save(): Promise<void> {
    const persistent = new Set(this.#persistence.load().sessions.map((session) => session.id));
    const state: NavigationState = {
      version: 1,
      sessionProjects: Object.fromEntries([...this.#owners].filter(([id]) => persistent.has(id))),
      lastSessions: Object.fromEntries([...this.#last].filter(([, id]) => persistent.has(id))),
      sidebar: this.#sidebar,
    };
    const text = JSON.stringify(state);
    if (text === this.#saved) return this.#pending;
    this.#saved = text;
    const job = this.#pending.then(async () => {
      await this.#inputs.storage.update(STORAGE_KEY, state);
      this.#saveFailure = undefined;
    });
    // Runtime/status refreshes are not a retry loop. New navigation or explicit
    // close/flush can retry a failed write, without repaint-driven disk/log churn.
    this.#pending = job.catch((error: unknown) => { this.#saveFailure = error; this.#inputs.reportError(error); });
    return job;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSidebar(value: unknown): value is DesktopSidebarLayout {
  return isObject(value) && Object.keys(value).length === 2 && typeof value.hidden === "boolean"
    && typeof value.width === "number" && Number.isFinite(value.width)
    && value.width >= DESKTOP_SIDEBAR_WIDTH.min && value.width <= DESKTOP_SIDEBAR_WIDTH.max;
}

function isNavigationState(value: unknown): value is NavigationState {
  return isObject(value) && value.version === 1 && isSidebar(value.sidebar)
    && isObject(value.sessionProjects) && Object.values(value.sessionProjects).every((owner) => typeof owner === "string")
    && isObject(value.lastSessions) && Object.values(value.lastSessions).every((id) => typeof id === "string");
}
