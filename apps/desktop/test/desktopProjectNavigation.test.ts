import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HostMemento, SessionRegistry } from "@frostime/pi-client/host";
import { SessionPersistence } from "@frostime/pi-client/host/sessions/SessionPersistence";
import type { SessionRuntimeStatus, WorkspaceViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import { describe, expect, it } from "vitest";

import { DesktopProjectNavigation } from "../src/main/DesktopProjectNavigation.js";
import { DesktopProjects } from "../src/main/desktopProjects.js";
import type { DesktopProject } from "../src/shared/desktopBridge.js";

const NAVIGATION_STORAGE_KEY = "frostpi.desktop.navigation.v1";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function expectationOfSessionId(id: string | undefined): string {
  if (!id) throw new Error("Expected the work to return a Session id.");
  return id;
}

interface MemoryMemento extends HostMemento {
  data: Map<string, unknown>;
  readonly failure: Error;
  /** Fails writes of the navigation key only; other Memento keys keep working. */
  failNavigationWrites: boolean;
  readonly navigationWrites: number;
}

function memoryMemento(): MemoryMemento {
  const data = new Map<string, unknown>();
  const control = { failNavigationWrites: false, navigationWrites: 0, failure: new Error("Navigation metadata could not be saved.") };
  return {
    data,
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: <T>(key: string, value: T) => {
      if (key === NAVIGATION_STORAGE_KEY) {
        control.navigationWrites += 1;
        if (control.failNavigationWrites) return Promise.reject(control.failure);
      }
      data.set(key, value);
      return Promise.resolve();
    },
    get failure() { return control.failure; },
    get failNavigationWrites() { return control.failNavigationWrites; },
    set failNavigationWrites(value: boolean) { control.failNavigationWrites = value; },
    get navigationWrites() { return control.navigationWrites; },
  };
}

function persistedSession(id: string, cwd: string) {
  return { id, title: `Session ${id}`, cwd, updatedAt: 1 };
}

interface WorkspaceRoots {
  projects: DesktopProjects;
  roots: { a: DesktopProject; b: DesktopProject; c: DesktopProject };
  parent: string;
}

/** Real Project identities over throwaway directories; removed even when the test throws. */
async function withWorkspace<T>(run: (workspace: WorkspaceRoots) => Promise<T>): Promise<T> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-navigation-")));
  try {
    const projects = new DesktopProjects();
    const roots = {} as WorkspaceRoots["roots"];
    for (const key of ["a", "b", "c"] as const) {
      const directory = join(parent, key);
      await mkdir(directory);
      roots[key] = await projects.addProject(directory);
    }
    projects.selectProject(roots.a.id);
    return await run({ projects, roots, parent });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

interface FakeSession {
  id: string;
  cwd: string;
  status: SessionRuntimeStatus;
  requiresUserInput: boolean;
}

function fakeSession(id: string, cwd: string): FakeSession {
  return { id, cwd, status: "ready", requiresUserInput: false };
}

/** Registry collaborator with the lifecycle contracts Desktop navigation relies on, without Pi processes. */
class FakeRegistry {
  readonly sessions = new Map<string, FakeSession>();
  readonly temporary = new Set<string>();
  readonly retained = new Set<string>();
  readonly activations: string[] = [];
  activeSessionId: string | null = null;
  resume: () => Promise<string | undefined> = () => Promise.resolve(undefined);
  opened: ((sessionId: string) => void) | undefined;
  /** Registry's onDidChange; the Desktop wiring refreshes navigation from it. */
  onChange: (() => void) | undefined;
  /** Lets a test hold one `clearActiveSession` call in flight. */
  nextClear: Promise<void> | undefined;
  #nextId = 1;

  constructor(sessions: FakeSession[] = []) {
    for (const session of sessions) this.sessions.set(session.id, session);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  snapshot(): WorkspaceViewModel {
    return {
      workspaceName: "Demo",
      workspacePath: "/demo",
      sessions: [...this.sessions.values()].map((session) => ({
        id: session.id,
        title: `Session ${session.id}`,
        cwd: session.cwd,
        status: session.status,
        isActive: session.id === this.activeSessionId,
        isEphemeral: false,
        historyStatus: "loaded",
        requiresUserInput: session.requiresUserInput,
      })),
      activeSessionId: this.activeSessionId,
      activeSession: null,
      piAvailable: true,
    } as unknown as WorkspaceViewModel;
  }

  async clearActiveSession(): Promise<void> {
    const gate = this.nextClear;
    this.nextClear = undefined;
    if (gate) await gate;
    this.activeSessionId = null;
    this.onChange?.();
  }

  activateSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return Promise.reject(new Error("This session no longer exists."));
    this.#discardActiveTemporarySession();
    this.activeSessionId = sessionId;
    this.activations.push(sessionId);
    this.onChange?.();
    return Promise.resolve();
  }

  retainProvisionalSession(sessionId: string): void {
    if (this.temporary.has(sessionId)) this.retained.add(sessionId);
  }

  /** Mirrors Registry creation: provisional identity, active foreground, owner hook, change event. */
  create(cwd: string, ephemeral = false): string {
    this.#discardActiveTemporarySession();
    const id = `created-${this.#nextId++}`;
    this.sessions.set(id, fakeSession(id, cwd));
    if (!ephemeral) this.temporary.add(id);
    this.activeSessionId = id;
    this.opened?.(id);
    this.onChange?.();
    return id;
  }

  /** Mirrors opening an existing record: the owner hook runs before the runtime is activated. */
  openExisting(sessionId: string): string {
    this.opened?.(sessionId);
    this.activeSessionId = sessionId;
    this.onChange?.();
    return sessionId;
  }

  #discardActiveTemporarySession(): void {
    const sessionId = this.activeSessionId;
    if (!sessionId || !this.temporary.has(sessionId) || this.retained.has(sessionId)) return;
    this.sessions.delete(sessionId);
    this.temporary.delete(sessionId);
    this.activeSessionId = null;
  }
}

interface NavigationHarness {
  navigation: DesktopProjectNavigation;
  registry: FakeRegistry;
  errors: unknown[];
}

function createNavigation(projects: DesktopProjects, registry: FakeRegistry, storage: HostMemento = memoryMemento()): NavigationHarness {
  const errors: unknown[] = [];
  const navigation = new DesktopProjectNavigation({
    projects,
    registry: registry as unknown as SessionRegistry,
    storage,
    publish: () => undefined,
    reportError: (error) => errors.push(error),
  });
  registry.opened = (sessionId) => navigation.sessionOpened(sessionId);
  registry.onChange = () => navigation.refresh();
  return { navigation, registry, errors };
}

describe("DesktopProjectNavigation", () => {
  it("switches A/B foregrounds, keeps unmatched worktree legacies under the saved anchor, and leaves an empty Project empty", async () => {
    await withWorkspace(async ({ projects, roots, parent }) => {
      const registry = new FakeRegistry([
        fakeSession("a1", roots.a.cwd),
        fakeSession("a2", roots.a.cwd),
        fakeSession("b1", roots.b.cwd),
        fakeSession("worktree", join(parent, "worktree-legacy")),
      ]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry);

      await navigation.initialize();
      expect(navigation.view.sessionProjects).toMatchObject({
        a1: roots.a.id, a2: roots.a.id, b1: roots.b.id, worktree: roots.a.id,
      });
      expect(projects.selected?.id).toBe(roots.a.id);

      await navigation.selectProject(roots.b.id);
      expect(registry.activeSessionId).toBe("b1");

      await navigation.activateSession("a2");
      expect(projects.selected?.id).toBe(roots.a.id);
      expect(registry.activeSessionId).toBe("a2");

      await navigation.selectProject(roots.c.id);
      expect(projects.selected?.id).toBe(roots.c.id);
      expect(registry.activeSessionId).toBeNull();
      expect(navigation.view.sessionProjects).toMatchObject({ a1: roots.a.id, a2: roots.a.id, b1: roots.b.id });

      await navigation.selectProject(roots.a.id);
      expect(registry.activeSessionId).toBe("a2");
    });
  });

  it("keeps a worktree New in the Project that started it even after the user switched Projects", async () => {
    await withWorkspace(async ({ projects, roots, parent }) => {
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("b1", roots.b.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      const discovery = deferred<void>();
      const worktree = join(parent, "worktree-feature");
      let ownerWhenPublished: string | undefined;
      const creating = navigation.run(async () => {
        await discovery.promise;
        const id = registry.create(worktree);
        // The Registry publishes the identity during creation, before this work returns.
        ownerWhenPublished = navigation.view.sessionProjects[id];
        return id;
      });
      await flush();
      await navigation.selectProject(roots.b.id);
      expect(registry.activeSessionId).toBe("b1");

      discovery.resolve();
      const created = expectationOfSessionId(await creating);
      expect(ownerWhenPublished).toBe(roots.a.id);
      expect(navigation.view.sessionProjects[created]).toBe(roots.a.id);
      expect(registry.sessions.get(created)?.cwd).toBe(worktree);
      await flush();
      // The late creation must not take B's foreground away from B's own conversation.
      expect(projects.selected?.id).toBe(roots.b.id);
      expect(registry.activeSessionId).toBe("b1");
    });
  });

  it("attributes concurrent creations to their originating Projects, not to completion order", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("b1", roots.b.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      let firstOwnerWhenPublished: string | undefined;
      let secondOwnerWhenPublished: string | undefined;
      const firstGate = deferred<void>();
      const secondGate = deferred<void>();
      const first = navigation.run(async () => {
        await firstGate.promise;
        const id = registry.create(roots.a.cwd);
        firstOwnerWhenPublished = navigation.view.sessionProjects[id];
        return id;
      });
      await flush();
      await navigation.selectProject(roots.b.id);
      const second = navigation.run(async () => {
        await secondGate.promise;
        const id = registry.create(roots.b.cwd);
        secondOwnerWhenPublished = navigation.view.sessionProjects[id];
        return id;
      });
      await flush();

      secondGate.resolve();
      const secondId = expectationOfSessionId(await second);
      firstGate.resolve();
      const firstId = expectationOfSessionId(await first);

      expect(firstId).not.toBe(secondId);
      expect(firstOwnerWhenPublished).toBe(roots.a.id);
      expect(secondOwnerWhenPublished).toBe(roots.b.id);
      expect(navigation.view.sessionProjects[firstId]).toBe(roots.a.id);
      expect(navigation.view.sessionProjects[secondId]).toBe(roots.b.id);
      await flush();
      expect(registry.activeSessionId).toBe(secondId);
    });
  });

  it("re-mounts an existing resumed Session to the selected Project and really displays it over that Project's previous last view", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("existing", roots.b.cwd)]);
      registry.activeSessionId = "existing";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();
      expect(projects.selected?.id).toBe(roots.b.id);

      // A already remembers its own conversation before the user resumes B's saved one.
      await navigation.selectProject(roots.a.id);
      expect(registry.activeSessionId).toBe("a1");

      registry.resume = () => Promise.resolve(registry.openExisting("existing"));
      await expect(navigation.run(registry.resume)).resolves.toBe("existing");
      await flush();

      // The restored target is foreground; the change event must not bounce back to a1.
      expect(projects.selected?.id).toBe(roots.a.id);
      expect(registry.activeSessionId).toBe("existing");
      expect(navigation.view.sessionProjects.existing).toBe(roots.a.id);
      expect(registry.sessions.get("existing")?.cwd).toBe(roots.b.cwd);
      expect(registry.sessions.has("a1")).toBe(true);
      expect(registry.sessions.size).toBe(2);

      await navigation.selectProject(roots.c.id);
      await navigation.selectProject(roots.a.id);
      expect(registry.activeSessionId).toBe("existing");
    });
  });

  it("inherits a fork's Project from its source Session", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("source", roots.a.cwd)]);
      registry.activeSessionId = "source";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();
      await navigation.selectProject(roots.b.id);
      expect(projects.selected?.id).toBe(roots.b.id);

      registry.sessions.set("forked", fakeSession("forked", roots.a.cwd));
      navigation.sessionOpened("forked", "source");
      expect(navigation.view.sessionProjects.forked).toBe(roots.a.id);
    });
  });

  it("retains the active provisional draft when a New session starts", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("draft", roots.a.cwd)]);
      registry.temporary.add("draft");
      registry.activeSessionId = "draft";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      const created = expectationOfSessionId(await navigation.run(() => Promise.resolve(registry.create(roots.a.cwd))));
      expect(registry.sessions.has("draft")).toBe(true);
      expect(navigation.view.sessionProjects.draft).toBe(roots.a.id);
      expect(navigation.view.sessionProjects[created]).toBe(roots.a.id);
    });
  });

  it("saves only shared-persisted identities and restores the sidebar and last view without auto-starting a conversation", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const storage = memoryMemento();
      const shared = new SessionPersistence(storage);
      await shared.save("a1", [persistedSession("a1", roots.a.cwd), persistedSession("b1", roots.b.cwd)]);

      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("b1", roots.b.cwd), fakeSession("draft", roots.a.cwd)]);
      registry.activeSessionId = "draft";
      const first = createNavigation(projects, registry, storage);
      await first.navigation.initialize();

      await expect(first.navigation.setSidebar({ hidden: false, width: 120 })).rejects.toThrow("Invalid Desktop sidebar layout.");
      registry.activeSessionId = "a1";
      first.navigation.refresh();
      await first.navigation.setSidebar({ hidden: true, width: 300 });
      await first.navigation.flush();

      const saved = storage.get<{
        sessionProjects: Record<string, string>;
        lastSessions: Record<string, string>;
        sidebar: { hidden: boolean; width: number };
      }>(NAVIGATION_STORAGE_KEY);
      expect(Object.keys(saved?.sessionProjects ?? {}).sort()).toEqual(["a1", "b1"]);
      expect(saved?.sessionProjects.draft).toBeUndefined();
      expect(saved?.lastSessions).toEqual({ [roots.a.id]: "a1" });
      expect(saved?.sidebar).toEqual({ hidden: true, width: 300 });

      // A restart restores the saved navigation with a real null foreground.
      await shared.save(null, [persistedSession("a1", roots.a.cwd), persistedSession("b1", roots.b.cwd)]);
      const restartedRegistry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("b1", roots.b.cwd)]);
      const second = createNavigation(projects, restartedRegistry, storage);
      await second.navigation.initialize();
      expect(restartedRegistry.activeSessionId).toBeNull();
      expect(restartedRegistry.activations).toEqual([]);
      expect(second.navigation.view.sidebar).toEqual({ hidden: true, width: 300 });

      await second.navigation.selectProject(roots.b.id);
      expect(restartedRegistry.activeSessionId).toBe("b1");
      await second.navigation.selectProject(roots.a.id);
      expect(restartedRegistry.activeSessionId).toBe("a1");
    });
  });

  it("does not retry a failed navigation save on every refresh, then retries once on explicit flush", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const storage = memoryMemento();
      await new SessionPersistence(storage).save("a1", [persistedSession("a1", roots.a.cwd)]);
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation, errors } = createNavigation(projects, registry, storage);

      storage.failNavigationWrites = true;
      await navigation.initialize();
      await flush();
      expect(storage.navigationWrites).toBe(1);
      expect(errors).toHaveLength(1);
      expect(storage.get(NAVIGATION_STORAGE_KEY)).toBeUndefined();

      // Runtime/status refreshes repeat the same navigation state; that must not hammer the store.
      navigation.refresh();
      navigation.refresh();
      await flush();
      expect(storage.navigationWrites).toBe(1);
      expect(errors).toHaveLength(1);

      storage.failNavigationWrites = false;
      await navigation.flush();
      await flush();
      expect(storage.navigationWrites).toBe(2);
      expect(errors).toHaveLength(1);
      const saved = storage.get<{
        sessionProjects: Record<string, string>;
        lastSessions: Record<string, string>;
      }>(NAVIGATION_STORAGE_KEY);
      expect(saved?.sessionProjects).toEqual({ a1: roots.a.id });
      expect(saved?.lastSessions).toEqual({ [roots.a.id]: "a1" });

      navigation.refresh();
      await flush();
      expect(storage.navigationWrites).toBe(2);
    });
  });

  it("rejects an explicit flush while navigation persistence keeps failing", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const storage = memoryMemento();
      await new SessionPersistence(storage).save("a1", [persistedSession("a1", roots.a.cwd)]);
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry, storage);

      storage.failNavigationWrites = true;
      await navigation.initialize();
      await flush();
      navigation.refresh();
      await flush();
      expect(storage.navigationWrites).toBe(1);

      // A failed retry must not resolve; the close path needs the real error.
      await expect(navigation.flush()).rejects.toBe(storage.failure);
      expect(storage.navigationWrites).toBe(2);

      navigation.refresh();
      await flush();
      expect(storage.navigationWrites).toBe(2);
    });
  });

  it("does not apply a Project switch that a newer selection superseded", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd), fakeSession("b1", roots.b.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      const clearing = deferred<void>();
      registry.nextClear = clearing.promise;
      const switching = navigation.selectProject(roots.b.id);
      await flush();
      await navigation.selectProject(roots.c.id);
      clearing.resolve();
      await switching;

      expect(projects.selected?.id).toBe(roots.c.id);
      expect(registry.activeSessionId).toBeNull();
      expect(registry.activations).toEqual([]);
    });
  });

  it("ignores late creation and later navigation after dispose", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("a1", roots.a.cwd)]);
      registry.activeSessionId = "a1";
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      const discovery = deferred<void>();
      const creating = navigation.run(async () => {
        await discovery.promise;
        return registry.create(roots.a.cwd);
      });
      await flush();
      navigation.dispose();
      discovery.resolve();
      const created = expectationOfSessionId(await creating);
      expect(navigation.view.sessionProjects[created]).toBeUndefined();

      await navigation.selectProject(roots.b.id);
      expect(projects.selected?.id).toBe(roots.a.id);
      navigation.sessionOpened("after-dispose");
      expect(navigation.view.sessionProjects["after-dispose"]).toBeUndefined();
    });
  });

  it("returns the work result unchanged and propagates its failure without claiming a Session", async () => {
    await withWorkspace(async ({ projects, roots }) => {
      const registry = new FakeRegistry([fakeSession("saved", roots.a.cwd)]);
      const { navigation } = createNavigation(projects, registry);
      await navigation.initialize();

      await expect(navigation.run(() => Promise.resolve("saved"))).resolves.toBe("saved");
      expect(navigation.view.sessionProjects).toEqual({ saved: roots.a.id });

      const failure = new Error("No saved sessions were found.");
      await expect(navigation.run(() => Promise.reject(failure))).rejects.toBe(failure);
      expect(navigation.view.sessionProjects).toEqual({ saved: roots.a.id });

      await expect(navigation.run(() => Promise.resolve(undefined))).resolves.toBeUndefined();
    });
  });
});
