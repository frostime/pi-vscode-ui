import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;
type DesktopApp = Awaited<ReturnType<typeof createDesktopApp>>;

/** Actual close/reopen with a Pi-owned synthetic JSONL, not a second FrostPi conversation store. */
export async function verifyDesktopStateReopen(directory: string, executable: string, waitFor: WaitFor): Promise<void> {
  const root = join(directory, "state-reopen");
  const aRoot = join(root, "project-a");
  const bRoot = join(root, "project-b");
  await mkdir(aRoot, { recursive: true });
  await mkdir(bRoot, { recursive: true });
  const settingsPath = join(root, "settings.json");
  const statePath = join(root, "state.json");
  const settings = await DesktopSettingsStore.open(settingsPath);
  await settings.replace({
    "frostpi.pi.executable": executable,
    "frostpi.pi.arguments": ["--persist-session-fixture"],
  });

  const closeNormally = async (desktop: DesktopApp): Promise<void> => {
    desktop.window.close();
    await waitFor(() => desktop.window.isDestroyed(), "normal close drains state before destroying its window");
    await desktop.dispose();
    assert.equal(desktop.stateStore.error, undefined);
  };
  const cleanup = async (desktop: DesktopApp): Promise<void> => {
    try { await desktop.dispose(); }
    finally { if (!desktop.window.isDestroyed()) desktop.window.destroy(); }
  };
  const entryIds = async (path: string): Promise<string[]> => (await readFile(path, "utf8"))
    .trim().split(/\r?\n/).map((line) => (JSON.parse(line) as { id: string }).id);
  const starts = async (path: string): Promise<number> => (await readFile(`${path}.starts`, "utf8"))
    .trim().split(/\r?\n/).length;

  const first = await createDesktopApp({
    settingsStore: settings, stateStore: await DesktopStateStore.open(statePath),
    directories: [aRoot, bRoot], show: false,
  });
  let a = "";
  let b = "";
  let aFile = "";
  let bFile = "";
  let projectIds: string[] = [];
  let selectedProject = "";
  let originalEntries: string[] = [];
  try {
    a = (await first.registry.createSession())!;
    await first.registry.sendPrompt(a, "state-restore-a", []);
    await waitFor(() => first.registry.sessionView(a)?.status === "ready", "Project A committed");
    const [projectA, projectB] = first.projects.list();
    projectIds = [projectA!.id, projectB!.id];
    selectedProject = projectB!.id;
    await first.window.webContents.executeJavaScript(`window.frostpiDesktop.selectProject(${JSON.stringify(selectedProject)})`);
    await waitFor(() => first.projects.selected?.id === selectedProject, "Project B becomes the saved New/Resume anchor");
    b = (await first.registry.createSession())!;
    await first.registry.sendPrompt(b, "state-restore-b", []);
    await waitFor(() => first.registry.sessionView(b)?.status === "ready", "Project B committed");
    // These remain visible in memory but must never become restartable saved entries.
    const ephemeral = (await first.registry.createSession(true))!;
    await first.registry.sendPrompt(ephemeral, "state-ephemeral", []);
    await waitFor(() => first.registry.sessionView(ephemeral)?.status === "ready", "ephemeral fixture settles");
    await first.registry.createSession();
    await first.registry.activateSession(a);
    aFile = first.registry.sessionView(a)!.sessionFile!;
    bFile = first.registry.sessionView(b)!.sessionFile!;
    originalEntries = await entryIds(aFile);
    assert.ok(originalEntries.length > 1);
    assert.equal(await starts(aFile), 1);
    assert.equal(await starts(bFile), 1);
    // Immediately close: normal shutdown must drain the latest active-session metadata.
    await closeNormally(first);
    const saved = JSON.parse(await readFile(statePath, "utf8")) as {
      projects: Array<{ id: string }>;
      activeProjectId: string;
      workspaceState: Record<string, { activeSessionId: string; sessions: Array<Record<string, unknown>> }>;
    };
    assert.deepEqual(Object.keys(saved).sort(), ["activeProjectId", "projects", "version", "workspaceState"]);
    assert.deepEqual(saved.projects.map((project) => project.id), projectIds);
    assert.equal(saved.activeProjectId, selectedProject);
    assert.deepEqual(Object.keys(saved.workspaceState), ["frostpi.sessions.v1"]);
    const registry = saved.workspaceState["frostpi.sessions.v1"]!;
    assert.equal(registry.activeSessionId, a);
    assert.deepEqual(registry.sessions.map((session) => session.id), [a, b]);
    for (const session of registry.sessions) {
      assert.deepEqual(Object.keys(session).sort(), ["cwd", "id", "sessionFile", "title", "updatedAt"]);
    }
  } finally { await cleanup(first); }

  const reopened = await createDesktopApp({
    settingsStore: await DesktopSettingsStore.open(settingsPath),
    stateStore: await DesktopStateStore.open(statePath), show: false,
  });
  try {
    assert.deepEqual(reopened.projects.list().map((project) => project.id), projectIds);
    assert.equal(reopened.projects.selected?.id, selectedProject);
    assert.equal(reopened.registry.activeSessionId, a);
    assert.deepEqual(reopened.registry.snapshot().sessions.map((session) => session.id), [a, b]);
    await waitFor(() => reopened.registry.sessionView(a)?.status === "ready"
      && reopened.registry.sessionView(a)?.historyStatus === "loaded", "selected saved Pi resumes its original file");
    await waitFor(() => reopened.window.webContents.executeJavaScript("document.body.innerText.includes('E2E response')"), "restored history reaches the shared conversation UI");
    assert.equal(reopened.registry.sessionView(b)?.status, "stopped");
    assert.equal(reopened.registry.sessionView(a)?.sessionFile, aFile);
    assert.equal(reopened.registry.sessionView(a)?.cwd, first.projects.list()[0]!.cwd);
    assert.equal(reopened.registry.sessionView(b)?.cwd, first.projects.list()[1]!.cwd);
    assert.equal(await starts(aFile), 2);
    assert.equal(await starts(bFile), 1);
    assert.deepEqual(await entryIds(aFile), originalEntries); // No automatic prompt replay.
    const temporary = (await reopened.registry.createSession(true))!;
    await reopened.registry.sendPrompt(temporary, "state-last-selection-temporary", []);
    await waitFor(() => reopened.registry.sessionView(temporary)?.status === "ready", "last selected temporary Pi settles");
    await closeNormally(reopened);
  } finally { await cleanup(reopened); }

  const unselected = await createDesktopApp({
    settingsStore: await DesktopSettingsStore.open(settingsPath),
    stateStore: await DesktopStateStore.open(statePath), show: false,
  });
  try {
    // startOnOpen is still true, but the last selected temporary session was deliberately not saved.
    assert.equal(unselected.registry.activeSessionId, null);
    assert.equal(unselected.registry.sessionView(a)?.status, "stopped");
    assert.equal(unselected.registry.sessionView(b)?.status, "stopped");
    assert.equal(await starts(aFile), 2);
    assert.equal(await starts(bFile), 1);
    await unselected.settingsStore.update("frostpi.session.startOnOpen", false);
    await unselected.registry.activateSession(a); // Explicit activation remains allowed.
    await waitFor(() => unselected.registry.sessionView(a)?.status === "ready", "explicit activation of a dormant saved Pi");
    await closeNormally(unselected);
  } finally { await cleanup(unselected); }

  const dormant = await createDesktopApp({
    settingsStore: await DesktopSettingsStore.open(settingsPath),
    stateStore: await DesktopStateStore.open(statePath), show: false,
  });
  try {
    assert.equal(dormant.registry.activeSessionId, a);
    assert.equal(dormant.registry.sessionView(a)?.status, "stopped");
    assert.equal(dormant.registry.sessionView(b)?.status, "stopped");
    assert.equal(await starts(aFile), 3);
    assert.equal(await starts(bFile), 1);
    await closeNormally(dormant);
  } finally { await cleanup(dormant); }
}
