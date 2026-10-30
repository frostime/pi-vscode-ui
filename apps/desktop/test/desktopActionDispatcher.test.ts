import type { DispatchConnection, HostMemento, SessionRegistry, WebviewActionDispatcherDependencies } from "@frostime/pi-client/host";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared";
import type { WorkspaceViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import type { WebviewSurface } from "@frostime/pi-client/shared/model/webviewPresentationModel";
import { describe, expect, it } from "vitest";

import { DesktopActionDispatcher } from "../src/main/DesktopActionDispatcher.js";
import { DesktopProjectNavigation } from "../src/main/DesktopProjectNavigation.js";
import { DesktopResume } from "../src/main/DesktopResume.js";
import type { DesktopProjects } from "../src/main/desktopProjects.js";
import type { DesktopProject } from "../src/shared/desktopBridge.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function memoryMemento(): HostMemento {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: <T>(key: string, value: T) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

/** Project collaborator without filesystem identity work; DesktopActionDispatcher only navigates. */
function fakeProjects(ids: readonly string[]): DesktopProjects {
  const projects: DesktopProject[] = ids.map((id) => ({ id, name: id.toUpperCase(), cwd: `/${id}` }));
  let selected: string | null = ids[0] ?? null;
  return {
    list: () => projects,
    get selected() {
      return projects.find((project) => project.id === selected) ?? null;
    },
    selectProject: (id: string | null) => {
      if (id !== null && !projects.some((project) => project.id === id)) throw new Error(`Unknown FrostPi Project: ${id}`);
      selected = id;
    },
  } as unknown as DesktopProjects;
}

/** Registry collaborator for the actions Desktop intercepts, without Pi processes or duplicated ownership. */
class FakeRegistry {
  readonly sessions = new Set<string>();
  readonly activations: string[] = [];
  activeSessionId: string | null = null;
  resume: () => Promise<string | undefined> = () => Promise.resolve(undefined);
  resumeCalls = 0;
  createCalls = 0;
  lastEphemeral: boolean | undefined;
  lastCreated: string | undefined;
  opened: ((sessionId: string) => void) | undefined;
  #nextId = 1;

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  snapshot(): WorkspaceViewModel {
    return {
      workspaceName: "Demo",
      workspacePath: "/demo",
      sessions: [...this.sessions].map((id) => ({
        id,
        title: `Session ${id}`,
        cwd: "/demo",
        status: "ready",
        isActive: id === this.activeSessionId,
        isEphemeral: false,
        historyStatus: "loaded",
        requiresUserInput: false,
      })),
      activeSessionId: this.activeSessionId,
      activeSession: null,
      piAvailable: true,
    } as unknown as WorkspaceViewModel;
  }

  clearActiveSession(): Promise<void> {
    this.activeSessionId = null;
    return Promise.resolve();
  }

  activateSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return Promise.reject(new Error("This FrostPi Session no longer exists."));
    this.activeSessionId = sessionId;
    this.activations.push(sessionId);
    return Promise.resolve();
  }

  retainProvisionalSession(): void {
    // Session ownership retention is covered by the DesktopProjectNavigation suite.
  }

  async resumeSession(): Promise<string | undefined> {
    this.resumeCalls += 1;
    return this.resume();
  }

  createSession(ephemeral: boolean): Promise<string> {
    this.createCalls += 1;
    this.lastEphemeral = ephemeral;
    return Promise.resolve(this.create());
  }

  create(): string {
    const id = `created-${this.#nextId++}`;
    this.sessions.add(id);
    this.activeSessionId = id;
    this.lastCreated = id;
    this.opened?.(id);
    return id;
  }
}

interface DispatcherHarness {
  dispatcher: DesktopActionDispatcher;
  resume: DesktopResume;
  navigation: DesktopProjectNavigation;
  registry: FakeRegistry;
  projects: DesktopProjects;
}

function createHarness(): DispatcherHarness {
  const projects = fakeProjects(["a", "b"]);
  const registry = new FakeRegistry();
  const resume = new DesktopResume({
    project: () => projects.selected,
    session: () => null,
    publish: () => undefined,
  });
  const navigation = new DesktopProjectNavigation({
    projects,
    registry: registry as unknown as SessionRegistry,
    storage: memoryMemento(),
    publish: () => undefined,
    reportError: () => undefined,
  });
  registry.opened = (sessionId) => navigation.sessionOpened(sessionId);
  const dispatcher = new DesktopActionDispatcher(
    { registry: registry as unknown as WebviewActionDispatcherDependencies["registry"] } as unknown as WebviewActionDispatcherDependencies,
    resume,
    navigation,
  );
  return { dispatcher, resume, navigation, registry, projects };
}

function dispatchConnection(surface: WebviewSurface): DispatchConnection {
  // The actions under test read only the surface; shared authorization is exercised through the panel rejection.
  return { surface, sessionId: null } as unknown as DispatchConnection;
}

const SIDEBAR = dispatchConnection({ kind: "sidebar" });

describe("DesktopActionDispatcher", () => {
  it("keeps panel actions with the shared sidebar-only rejection and runs no Desktop work", async () => {
    const { dispatcher, resume, registry } = createHarness();
    const panel = dispatchConnection({ kind: "panel", sessionId: "s1" });

    await expect(dispatcher.dispatch({ type: "resumeSession", bridgeVersion: BRIDGE_VERSION }, panel))
      .rejects.toThrow("Open the FrostPi sidebar to resume a session.");
    await expect(dispatcher.dispatch({ type: "createSession", bridgeVersion: BRIDGE_VERSION }, panel))
      .rejects.toThrow("This action is available only from the FrostPi sidebar.");
    await expect(dispatcher.dispatch({ type: "activateSession", sessionId: "s1", bridgeVersion: BRIDGE_VERSION }, panel))
      .rejects.toThrow("This action is available only from the FrostPi sidebar.");

    expect(registry.resumeCalls).toBe(0);
    expect(registry.createCalls).toBe(0);
    expect(registry.activations).toEqual([]);
    expect(resume.view).toBeNull();
  });

  it("activates a Session from another Project through Desktop navigation and hides the overlay", async () => {
    const { dispatcher, resume, navigation, registry, projects } = createHarness();
    registry.sessions.add("s1");
    navigation.sessionOpened("s1");
    projects.selectProject("b");
    registry.sessions.add("s2");
    navigation.sessionOpened("s2");
    projects.selectProject("a");
    registry.activeSessionId = "s1";

    const discovery = deferred<void>();
    const overlay = resume.run(async () => {
      await discovery.promise;
      return undefined;
    });
    await flush();
    expect(resume.view).toMatchObject({ phase: "finding", visible: true });

    await dispatcher.dispatch({ type: "activateSession", sessionId: "s2", bridgeVersion: BRIDGE_VERSION }, SIDEBAR);
    expect(projects.selected?.id).toBe("b");
    expect(registry.activeSessionId).toBe("s2");
    expect(resume.view).toMatchObject({ visible: false });

    discovery.resolve();
    await overlay;
  });

  it("rejects activation of an unknown Session and presents a resume failure in the overlay", async () => {
    const { dispatcher, resume, navigation, registry } = createHarness();
    registry.sessions.add("s1");
    navigation.sessionOpened("s1");
    registry.activeSessionId = "s1";

    await expect(dispatcher.dispatch({ type: "activateSession", sessionId: "gone", bridgeVersion: BRIDGE_VERSION }, SIDEBAR))
      .rejects.toThrow("This FrostPi Session no longer exists.");
    expect(resume.view).toBeNull();

    // New failures stay ordinary action errors; only Resume owns an overlay for them.
    const failure = new Error("Pi is unavailable.");
    registry.createSession = () => Promise.reject(failure);
    await expect(dispatcher.dispatch({ type: "createSession", bridgeVersion: BRIDGE_VERSION }, SIDEBAR)).rejects.toBe(failure);
    expect(resume.view).toBeNull();

    registry.resume = () => Promise.reject(new Error("No saved sessions were found."));
    await expect(dispatcher.dispatch({ type: "resumeSession", bridgeVersion: BRIDGE_VERSION }, SIDEBAR)).resolves.toBeUndefined();
    expect(registry.resumeCalls).toBe(1);
    expect(resume.view).toMatchObject({ phase: "failed", error: "No saved sessions were found." });
  });

  it("attributes a sidebar New to the selected Project and hides the overlay", async () => {
    const { dispatcher, resume, navigation, registry } = createHarness();
    registry.sessions.add("s1");
    navigation.sessionOpened("s1");
    registry.activeSessionId = "s1";

    const discovery = deferred<void>();
    const overlay = resume.run(async () => {
      await discovery.promise;
      return undefined;
    });
    await flush();

    await dispatcher.dispatch({ type: "createSession", ephemeral: true, bridgeVersion: BRIDGE_VERSION }, SIDEBAR);
    const created = registry.lastCreated;
    expect(created).toBeDefined();
    expect(registry.lastEphemeral).toBe(true);
    expect(navigation.view.sessionProjects[created ?? ""]).toBe("a");
    expect(resume.view).toMatchObject({ visible: false });

    discovery.resolve();
    await overlay;
  });
});
