import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import { createDesktopBackend } from "../src/main/createDesktopBackend.js";
import type { DesktopBackendOptions } from "../src/main/createDesktopBackend.js";
import type { DesktopNative, DesktopTransport } from "../src/main/desktopNative.js";
import type { DesktopUpdateNativeView } from "../src/shared/desktopUpdates.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import type { DesktopUpdateView } from "../src/shared/desktopUpdates.js";
import type { DesktopProjectsView } from "../src/shared/desktopBridge.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
async function fixture(overrides: Partial<DesktopBackendOptions> = {}, firstRun = false) {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-backend-test-"));
  disposals.push(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project"); await mkdir(project);
  const executable = join(directory, "pi.cjs");
  await cp(resolve("../pi-client/test/fixtures/fake-pi.cjs"), executable);
  const settingsStore = await DesktopSettingsStore.open(join(directory, "settings.json"));
  if (!firstRun) await settingsStore.replace({ "frostpi.pi.executable": executable, "frostpi.session.startOnOpen": false, "frostpi.pi.arguments": ["--persist-session-fixture"] });
  const listeners = new Map<string, (...values: unknown[]) => void | Promise<void>>();
  const handlers = new Map<string, (value: unknown) => Promise<unknown>>();
  const events: Array<{ channel: string; value: unknown }> = [];
  const native = {
    focused: () => true, message: vi.fn(), confirm: vi.fn(), openFiles: vi.fn(), chooseDirectory: vi.fn(),
    writeClipboard: vi.fn(), openExternal: vi.fn(), openPath: vi.fn(), launch: vi.fn(), appearance: vi.fn(),
    updates: vi.fn((): Promise<DesktopUpdateNativeView> => Promise.resolve({ currentVersion: "test", configured: true, checked: false, operation: "idle" })),
  } satisfies DesktopNative;
  const transport: DesktopTransport = {
    publish: (channel, value) => { events.push({ channel, value }); return true; },
    listen: (channel, action) => { listeners.set(channel, action); return () => { listeners.delete(channel); }; },
    handle: (channel, action) => { handlers.set(channel, action); return () => { handlers.delete(channel); }; },
    visible: () => true, onVisibility: () => () => undefined,
  };
  const options = {
    profile: directory, artifacts: resolve("dist"), clientVersion: "test", directories: [project], settingsStore, native, transport,
    // Detection must be deterministic: no tool from the host's real PATH is enabled.
    projectActionEnvironment: { PATH: "", exists: () => Promise.resolve(false) },
    ...overrides,
  };
  const backend = await createDesktopBackend(options);
  disposals.push(backend.dispose);
  const send = async (channel: string, ...values: unknown[]) => { await listeners.get(channel)?.(...values); };
  return { directory, project, options, backend, events, native, send, handlers, listeners };
}

describe("Desktop backend assembly", () => {
  it("requires exit confirmation for a running background Session, but not an idle Pi process", async () => {
    const { backend, directory } = await fixture();
    await backend.settingsStore.update("frostpi.pi.arguments", ["--persist-session-fixture", "--stream-084-release", join(directory, "release-stream")]);
    expect(backend.requiresExitConfirmation()).toBe(false);
    const id = await backend.registry.createSession();
    if (!id) throw new Error("Expected a new Session");
    await vi.waitFor(() => expect(backend.registry.sessionView(id)?.status).toBe("ready"));
    expect(backend.requiresExitConfirmation()).toBe(false);
    await backend.registry.sendPrompt(id, "stream-084", []);
    await vi.waitFor(() => expect(backend.registry.sessionView(id)?.isStreaming).toBe(true));
    await backend.registry.clearActiveSession();
    expect(backend.registry.activeSessionId).toBeNull();
    expect(backend.requiresExitConfirmation()).toBe(true);
    await backend.registry.abort(id);
    await vi.waitFor(() => expect(backend.requiresExitConfirmation()).toBe(false));
  });
  it("shows Resume before discovery finishes, cancels without a Pi, and surfaces a later discovery failure", async () => {
    let release!: () => void;
    const discovery = new Promise<void>((done) => { release = done; });
    let fail = false;
    const { backend, send, events } = await fixture({ discoverWorkingDirectories: async () => { await discovery; if (fail) throw new Error("Controlled discovery failure"); return { directories: [], authoritative: true }; } });
    const resume = () => send("frostpi:client:in", { type: "resumeSession", bridgeVersion: BRIDGE_VERSION });
    await resume();
    await vi.waitFor(() => expect(events.some((event) => event.channel === "frostpi:resume:view" && (event.value as { phase?: string })?.phase === "finding")).toBe(true));
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(events.at(-1)?.value === null || events.some((event) => event.channel === "frostpi:resume:view" && event.value === null)).toBe(true));
    fail = true; await resume();
    await vi.waitFor(() => expect(events.some((event) => event.channel === "frostpi:resume:view" && (event.value as { error?: string })?.error === "Controlled discovery failure")).toBe(true));
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
  });
  it("flushes rapid zoom writes on disposal, clamps the saved value, and removes handlers", async () => {
    const { backend, send, handlers, listeners, directory } = await fixture();
    for (let i = 0; i < 30; i++) await send("frostpi:zoom", "in");
    await backend.dispose();
    expect((JSON.parse(await readFile(join(directory, "settings.json"), "utf8")) as Record<string, unknown>)["desktop.zoomFactor"]).toBe(2);
    expect(handlers.size).toBe(0); expect(listeners.size).toBe(0);
  });
  it("retains Project/sidebar and durable Session identity across close, while a saved null selection starts no Pi", async () => {
    const { backend, send, options } = await fixture();
    const id = await backend.registry.createSession();
    expect(id).toBeTruthy();
    await vi.waitFor(() => expect(backend.registry.snapshot().activeSession?.status).toBe("ready"));
    await backend.registry.sendPrompt(id!, "persist-backend-session", []);
    await vi.waitFor(() => expect(backend.registry.snapshot().activeSession?.isStreaming).toBe(false));
    await send("frostpi:sidebar:set", { hidden: true, width: 292 });
    await backend.registry.clearActiveSession();
    await backend.dispose();
    const reopened = await createDesktopBackend({ ...options, directories: [] }); disposals.push(reopened.dispose);
    expect(reopened.projects.list()).toHaveLength(1);
    expect(reopened.navigation.view.sidebar).toEqual({ hidden: true, width: 292 });
    expect(reopened.registry.snapshot().sessions.map((session) => session.id)).toEqual([id]);
    expect(reopened.registry.activeSessionId).toBe(null);
    expect(reopened.registry.snapshot().sessions[0]?.status).toBe("stopped");
  });
  it("keeps imported settings as a preview until save and refuses import after initialization", async () => {
    const source = join(await mkdtemp(join(tmpdir(), "frostpi-import-source-")), "settings.json");
    disposals.push(() => rm(resolve(source, ".."), { recursive: true, force: true }));
    const original = '{ // synthetic VS Code defaults\n "chat.fontSize":19, "editor.fontFamily":"Import Mono", }';
    await writeFile(source, original);
    const { backend, handlers } = await fixture({ vscodeSettingsPath: source }, true);
    const fresh = backend.settingsStore;
    const action = handlers.get("frostpi:settings:action")!;
    const preview = await action({ type: "importVscode" }) as { ok: boolean; view: { values: Record<string, unknown> } };
    expect(preview.ok).toBe(true); expect(preview.view.values["chat.fontSize"]).toBe(19);
    expect(fresh.values).toEqual({}); expect(fresh.firstRun).toBe(true);
    await action({ type: "save", values: preview.view.values });
    expect(fresh.firstRun).toBe(false);
    expect(await readFile(source, "utf8")).toBe(original);
    expect((await action({ type: "importVscode" }) as { ok: boolean }).ok).toBe(false);
    await backend.dispose();
  });
  it("reorders Projects over the bridge and persists the new order", async () => {
    const { backend, directory, events, send } = await fixture();
    await backend.projects.addProject(await mkdtemp(join(directory, "second-")));
    await backend.projects.addProject(await mkdtemp(join(directory, "third-")));
    const [first, second, third] = backend.projects.list();
    const view = (): DesktopProjectsView => events.filter((event) => event.channel === "frostpi:projects:view").at(-1)?.value as DesktopProjectsView;

    await send("frostpi:projects:move", third!.id, 0);

    const expected = [third!.id, first!.id, second!.id];
    expect(backend.projects.list().map((project) => project.id)).toEqual(expected);
    expect(view().projects.map((project) => project.id)).toEqual(expected);
    await backend.stateStore.flush();
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as { projects: Array<{ id: string }> };
    expect(saved.projects.map((project) => project.id)).toEqual(expected);
  });
  it("refreshes command menus on settings Save and resolves command scope/cwd in the backend", async () => {
    const { backend, native, events, send, handlers, directory } = await fixture({
      projectActionEnvironment: { PATH: "C:/tools", exists: (path) => Promise.resolve(/(?:wt|powershell)\.exe$/u.test(path)) },
    });
    const first = backend.projects.list()[0]!;
    const second = await backend.projects.addProject(await mkdtemp(join(directory, "second-")));
    const commands = [{ id: "local", label: "Local", command: "Write-Output secret {{cwd}}", projectId: first.id }];
    const settings = handlers.get("frostpi:settings:action")!;
    expect(await settings({ type: "save", values: { ...backend.settingsStore.values, "desktop.actions": commands } })).toMatchObject({ ok: true });
    const view = events.filter((event) => event.channel === "frostpi:projects:view").at(-1)?.value as DesktopProjectsView;
    expect(view.actions).toContainEqual({ id: "custom:local", label: "Local", icon: "codicon-folder", section: "actions", scope: "project", projectId: first.id });
    expect(JSON.stringify(view)).not.toContain("secret");

    await send("frostpi:projects:action", second.id, "custom:local");
    await vi.waitFor(() => expect(events.some((event) => (event.value as { message?: string })?.message === "This Action belongs to a different Project.")).toBe(true));
    expect(native.launch).not.toHaveBeenCalled();
    await send("frostpi:projects:action", first.id, "custom:local", "C:/renderer-injected");
    await vi.waitFor(() => expect(native.launch).toHaveBeenCalledOnce());
    const args = native.launch.mock.calls[0]![1] as string[];
    const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    expect(script).toContain(first.cwd.replaceAll("'", "''"));
    expect(script).not.toContain("renderer-injected");
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
  });
  it("runs a Project action for the project cwd and reports an unknown action as a toast", async () => {
    const { backend, native, events, send } = await fixture();
    const project = backend.projects.list()[0]!;
    await send("frostpi:projects:request");
    const view = events.filter((event) => event.channel === "frostpi:projects:view").at(-1)?.value as DesktopProjectsView;
    expect(view.actions).toEqual([{ id: "reveal", label: "Open in File Explorer", icon: "codicon-folder-opened" }]);

    await send("frostpi:projects:action", project.id, "reveal");
    await vi.waitFor(() => expect(native.openPath).toHaveBeenCalledWith(project.cwd));

    // A stale or forged action id must surface as a toast, not escape the listener.
    await expect(send("frostpi:projects:action", project.id, "unknown")).resolves.toBeUndefined();
    await vi.waitFor(() => expect(events.some((event) => {
      const value = event.value as { type?: string; level?: string; message?: string } | null;
      return event.channel === "frostpi:client:out" && value?.type === "toast" && value.level === "error"
        && value.message === "Unknown Project action: unknown";
    })).toBe(true));
    expect(native.launch).not.toHaveBeenCalled();
  });
});

describe("Desktop update actions and Session admission", () => {
  const updateAction = (handlers: Map<string, (value: unknown) => Promise<unknown>>) => handlers.get("frostpi:updates:action")!;

  it("forwards read, check and download with an open Session and merges the real Session block", async () => {
    const { backend, native, events, handlers } = await fixture();
    const id = await backend.registry.createSession();
    await vi.waitFor(() => expect(backend.registry.sessionView(id!)?.status).toBe("ready"), { timeout: 5000 });
    const action = updateAction(handlers);

    for (const type of ["read", "check", "download"] as const) {
      const view = await action({ type }) as DesktopUpdateView;
      expect(native.updates).toHaveBeenLastCalledWith({ type });
      expect(view).toEqual({ currentVersion: "test", configured: true, checked: false, operation: "idle", installBlock: { reason: "sessions", count: 1 } });
      expect(events.filter((event) => event.channel === "frostpi:updates:view").at(-1)?.value).toEqual(view);
    }
  });

  it("forwards install to the host and publishes native progress with the Node-owned block", async () => {
    const { backend, native, events, handlers } = await fixture();
    const action = updateAction(handlers);

    // Node does not decide install eligibility; the shell asks prepareUpdate itself.
    const accepted = await action({ type: "install" }) as DesktopUpdateView;
    expect(native.updates).toHaveBeenLastCalledWith({ type: "install" });
    expect(accepted).toEqual({ currentVersion: "test", configured: true, checked: false, operation: "idle" });

    const id = await backend.registry.createSession();
    await vi.waitFor(() => expect(backend.registry.sessionView(id!)?.status).toBe("ready"), { timeout: 5000 });
    const progress = { currentVersion: "0.17.0", configured: true, checked: true, operation: "downloading" as const, progress: { receivedBytes: 10, totalBytes: 100 } };
    backend.updateView(progress);
    expect(events.filter((event) => event.channel === "frostpi:updates:view").at(-1)?.value)
      .toEqual({ ...progress, installBlock: { reason: "sessions", count: 1 } });

    // The shell cannot supply the block or any other renderer-visible field.
    const published = events.filter((event) => event.channel === "frostpi:updates:view").length;
    expect(() => backend.updateView({ ...progress, installBlock: { reason: "opening" } })).toThrow("invalid view");
    expect(() => backend.updateView({ ...progress, downloadUrl: "https://example.invalid/update.json" })).toThrow("invalid view");
    expect(events.filter((event) => event.channel === "frostpi:updates:view")).toHaveLength(published);
  });

  it("refuses preparation for a Session in another Project and after that Session stopped", async () => {
    const { backend, directory, options, send } = await fixture();
    const id = await backend.registry.createSession();
    await vi.waitFor(() => expect(backend.registry.sessionView(id!)?.status).toBe("ready"), { timeout: 5000 });
    // Saved Pi history is what keeps a Session durable after it stops.
    await backend.registry.sendPrompt(id!, "persist-update-session", []);
    await vi.waitFor(() => expect(backend.registry.snapshot().activeSession?.isStreaming).toBe(false), { timeout: 5000 });
    const other = await backend.projects.addProject(await mkdtemp(join(directory, "other-")));
    await send("frostpi:projects:select", other.id);
    expect(backend.registry.activeSessionId).toBeNull();
    expect(backend.registry.snapshot().sessions).toHaveLength(1);
    expect(backend.prepareUpdate()).toEqual({ ok: false, reason: "sessions", count: 1 });

    await backend.dispose();
    const reopened = await createDesktopBackend({ ...options, directories: [] }); disposals.push(reopened.dispose);
    expect(reopened.registry.snapshot().sessions.map((session) => session.status)).toEqual(["stopped"]);
    expect(reopened.prepareUpdate()).toEqual({ ok: false, reason: "sessions", count: 1 });
  });

  it("blocks an empty-Set install while New/Resume is unfinished, then refuses new Sessions until cancelled", async () => {
    let release!: () => void;
    const discovery = new Promise<void>((done) => { release = done; });
    const { backend, project, events, handlers, send } = await fixture({
      discoverWorkingDirectories: async () => {
        await discovery;
        return { directories: [{ cwd: project, workspaceFolderCwd: project, directoryName: "project", isCurrent: true }], authoritative: true };
      },
    });
    const seeded = await updateAction(handlers)({ type: "read" }) as DesktopUpdateView;
    expect(seeded.installBlock).toBeUndefined();
    void send("frostpi:client:in", { type: "resumeSession", bridgeVersion: BRIDGE_VERSION });
    const dialogId = (): string | undefined => (events.filter((event) => event.channel === "frostpi:dialog:view").at(-1)?.value as { id?: string } | null)?.id;
    await vi.waitFor(() => expect(events.some((event) => event.channel === "frostpi:resume:view" && (event.value as { phase?: string })?.phase === "finding")).toBe(true), { timeout: 5000 });
    // The existing view reports the unfinished New/Resume as soon as it starts, before it settles.
    expect(events.filter((event) => event.channel === "frostpi:updates:view").at(-1)?.value)
      .toEqual({ ...seeded, installBlock: { reason: "opening" } });
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
    expect(backend.prepareUpdate()).toEqual({ ok: false, reason: "opening" });

    // Discovery finished but the Resume picker still waits: the empty set cannot admit an install.
    release();
    await vi.waitFor(() => expect(dialogId()).toBeDefined(), { timeout: 5000 });
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
    expect(backend.prepareUpdate()).toEqual({ ok: false, reason: "opening" });

    await send("frostpi:dialog:response", dialogId(), null);
    await vi.waitFor(() => expect(events.some((event) => event.channel === "frostpi:resume:view" && event.value === null)).toBe(true), { timeout: 5000 });
    expect(backend.registry.snapshot().sessions).toHaveLength(0);
    expect(backend.prepareUpdate()).toEqual({ ok: true });

    // The gate stays closed: a later New reaches no Pi child and creates no Session.
    await send("frostpi:client:in", { type: "createSession", bridgeVersion: BRIDGE_VERSION });
    await vi.waitFor(() => expect(events.some((event) => event.channel === "frostpi:client:out"
      && (event.value as { message?: string })?.message?.includes("preparing to install"))).toBe(true), { timeout: 5000 });
    expect(backend.registry.snapshot().sessions).toHaveLength(0);

  });

  it("rejects forged update actions before reaching the host", async () => {
    const { native, handlers } = await fixture();
    const action = updateAction(handlers);
    for (const forged of [
      { type: "check", url: "https://example.invalid/update.json" },
      { type: "download", path: "C:\\Temp\\update.msi" },
      { type: "install", path: "C:\\Temp\\update.msi" },
      { type: "apply" }, "check", null,
    ]) await expect(action(forged)).rejects.toThrow(/Invalid Desktop update action/);
    expect(native.updates).not.toHaveBeenCalled();
  });
});
