import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import { createDesktopBackend } from "../src/main/createDesktopBackend.js";
import type { DesktopBackendOptions } from "../src/main/createDesktopBackend.js";
import type { DesktopNative, DesktopTransport } from "../src/main/desktopNative.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";

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
    writeClipboard: vi.fn(), openExternal: vi.fn(), openPath: vi.fn(), appearance: vi.fn(),
  } satisfies DesktopNative;
  const transport: DesktopTransport = {
    publish: (channel, value) => { events.push({ channel, value }); return true; },
    listen: (channel, action) => { listeners.set(channel, action); return () => { listeners.delete(channel); }; },
    handle: (channel, action) => { handlers.set(channel, action); return () => { handlers.delete(channel); }; },
    visible: () => true, onVisibility: () => () => undefined,
  };
  const options = { profile: directory, artifacts: resolve("dist"), clientVersion: "test", directories: [project], settingsStore, native, transport, ...overrides };
  const backend = await createDesktopBackend(options);
  disposals.push(backend.dispose);
  const send = async (channel: string, ...values: unknown[]) => { await listeners.get(channel)?.(...values); };
  return { directory, project, options, backend, events, native, send, handlers, listeners };
}

describe("Desktop backend assembly", () => {
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
});
