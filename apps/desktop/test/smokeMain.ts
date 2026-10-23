import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, type WebContents } from "electron";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";
import { verifyDesktopStateReopen } from "./statePersistenceSmoke.js";

const directory = process.env.FROSTPI_DESKTOP_SMOKE_DIR!;
app.setPath("userData", join(directory, "electron-profile"));
app.on("before-quit", (event) => event.preventDefault());

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Desktop smoke timed out: ${label}`);
}

async function closeSettings(browser: WebContents): Promise<void> {
  await browser.executeJavaScript("document.querySelector('dialog[aria-labelledby=\"settings-title\"] header button').click()");
  await until(() => browser.executeJavaScript("!document.querySelector('#settings-title')"), "settings modal closes");
}

async function verifySettingsSetup(): Promise<void> {
  const sourcePath = join(directory, "vscode-default-user-settings.json");
  const settingsPath = join(directory, "first-run/settings.json");
  const source = '{ // default VS Code user settings\n "chat.fontSize": 19, "chat.editor.fontSize": 17, "editor.fontFamily": "Import Mono", "files.exclude": {"**/generated": true}, "[typescript]": {"chat.fontSize": 99}, }';
  await writeFile(sourcePath, source);
  const store = await DesktopSettingsStore.open(settingsPath);
  const setup = await createDesktopApp({ settingsStore: store, stateStore: await DesktopStateStore.open(join(directory, "first-run/state.json")), vscodeSettingsPath: sourcePath, show: false });
  const browser = setup.window.webContents;
  try {
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), "first-run settings modal");
    await browser.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Import VS Code defaults').click()");
    await until(() => browser.executeJavaScript("document.getElementById('setting-chat.fontSize')?.value==='19'"), "default-user import populates editable form");
    assert.equal(store.firstRun, true);
    assert.deepEqual(store.values, {});
    assert.doesNotMatch(await browser.executeJavaScript("document.documentElement.style.getPropertyValue('--vscode-editor-font-family')") as string, /Import Mono/);
    await browser.executeJavaScript("document.querySelector('dialog .save').click()");
    await until(() => !store.firstRun && store.values["chat.fontSize"] === 19, "Save commits imported dot keys");
    await until(() => browser.executeJavaScript("document.documentElement.style.getPropertyValue('--vscode-editor-font-family')==='Import Mono'"), "Save applies imported editor font family");
    assert.equal(await readFile(sourcePath, "utf8"), source);
    assert.deepEqual(store.values, {
      "chat.fontSize": 19, "chat.editor.fontSize": 17,
      "editor.fontFamily": "Import Mono", "files.exclude": { "**/generated": true },
    });
    setup.window.showInactive();
    await writeFile(join(directory, "desktop-settings.png"), (await browser.capturePage()).toPNG());
    setup.window.setSize(280, 700);
    await browser.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const narrow: unknown = await browser.executeJavaScript("(()=>{const d=document.querySelector('dialog');const r=d.getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth,noHorizontalScroll:d.scrollWidth<=d.clientWidth+1};})()");
    assert.deepEqual(narrow, { fits: true, noHorizontalScroll: true });
    await writeFile(join(directory, "desktop-settings-280.png"), (await browser.capturePage()).toPNG());
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Reset chat.fontSize\"]').click();document.querySelector('dialog .save').click()");
    await until(() => !("chat.fontSize" in store.values), "Reset removes override rather than storing default");
    await until(() => browser.executeJavaScript("document.documentElement.style.getPropertyValue('--frostpi-chat-message-font-size')==='13px'"), "Reset restores shared message size");
    await assert.rejects(browser.executeJavaScript("window.frostpiDesktop.settings({type:'save',values:{'chat.fontSize':'wrong-type'}})"));
    assert.equal(store.values["chat.editor.fontSize"], 17);
    await assert.rejects(browser.executeJavaScript("window.frostpiDesktop.settings({type:'arbitraryFileRead',path:'not-authorized'})"));
  } finally {
    await setup.dispose(); setup.window.destroy();
  }
  // A new app instance reads Desktop settings and must not import the changed VS Code file again.
  await writeFile(sourcePath, '{"chat.editor.fontSize":99}');
  const reopenedStore = await DesktopSettingsStore.open(settingsPath);
  assert.equal(reopenedStore.values["chat.editor.fontSize"], 17);
  const reopened = await createDesktopApp({ settingsStore: reopenedStore, stateStore: await DesktopStateStore.open(join(directory, "first-run/state.json")), vscodeSettingsPath: sourcePath, show: false });
  try {
    await until(() => reopened.window.webContents.executeJavaScript("document.documentElement.style.getPropertyValue('--vscode-editor-font-family')==='Import Mono'"), "reopen applies persisted settings");
    assert.equal(await reopened.window.webContents.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), false);
    assert.equal(reopenedStore.values["chat.editor.fontSize"], 17);
  } finally {
    await reopened.dispose(); reopened.window.destroy();
  }
}

async function verifyStartupSettingsEntries(): Promise<void> {
  const store = await DesktopSettingsStore.open(join(directory, "startup-settings/settings.json"));
  const missingExecutable = join(directory, "missing-pi-executable");
  await store.replace({ "frostpi.pi.executable": missingExecutable });
  const desktop = await createDesktopApp({ settingsStore: store, stateStore: await DesktopStateStore.open(join(directory, "startup-settings/state.json")), directories: [join(directory, "project-a")], show: false });
  const browser = desktop.window.webContents;
  try {
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('.onboarding-actions .primary'))"), "failure fixture New action");
    await browser.executeJavaScript("document.querySelector('.onboarding-actions .primary').click()");
    await until(() => browser.executeJavaScript("document.querySelector('.onboarding-view h1')?.textContent==='Pi could not start'"), "real failed startup presentation");
    await browser.executeJavaScript("[...document.querySelectorAll('.onboarding-actions button')].find(b=>b.textContent.includes('Configure Pi')).click()");
    await until(() => browser.executeJavaScript("document.activeElement?.id==='setting-frostpi.pi.executable'"), "Configure Pi focuses existing executable setting");
    assert.equal(store.values["frostpi.pi.executable"], missingExecutable);
    await closeSettings(browser);
    await browser.executeJavaScript("[...document.querySelectorAll('.onboarding-actions button')].find(b=>b.textContent.trim()==='Settings').click()");
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), "failed startup Settings opens Desktop settings");
    assert.equal(store.values["frostpi.pi.executable"], missingExecutable);
  } finally {
    await desktop.dispose(); desktop.window.destroy();
  }
}

void app.whenReady().then(async () => {
  const settingsStore = await DesktopSettingsStore.open(join(directory, "electron-profile/settings.json"));
  await settingsStore.replace({
    "frostpi.pi.executable": process.env.FROSTPI_DESKTOP_SMOKE_PI!,
    "frostpi.pi.arguments": ["--stream-084-release", join(directory, "release-stream")],
  });
  const desktop = await createDesktopApp({
    directories: [join(directory, "project-a"), join(directory, "project-b")], show: false, settingsStore,
    stateStore: await DesktopStateStore.open(join(directory, "live/state.json")),
  });
  const browser = desktop.window.webContents;
  const text = (): Promise<string> => browser.executeJavaScript("document.body.innerText");
  try {
    await until(async () => (await text()).includes("Start or resume a Pi session"), "shared empty state");
    await browser.executeJavaScript("document.querySelector('.onboarding-actions .primary').click()");
    await until(() => {
      const current = desktop.registry.snapshot().activeSession;
      if (current?.status === "failed") throw new Error(current.error ?? "Project A startup failed");
      return current?.status === "ready";
    }, "Project A New through existing UI/IPC");
    const a = desktop.registry.activeSessionId!;
    await desktop.registry.sendPrompt(a, "commit project A", []);
    await until(async () => (await text()).includes("E2E response"), "shared conversation rendering");
    const [projectA, projectB] = desktop.projects.list();
    await browser.executeJavaScript(`window.frostpiDesktop.selectProject(${JSON.stringify(projectB!.id)})`);
    await until(() => desktop.projects.selected?.id === projectB!.id, "Project B selection");
    assert.equal(desktop.registry.sessionView(a)?.cwd, projectA!.cwd);
    await browser.executeJavaScript("document.querySelector('[aria-label=\"New or resume session\"]').click()");
    await until(() => browser.executeJavaScript("!!document.querySelector('.launcher-create')"), "New menu opens");
    await browser.executeJavaScript("document.querySelector('.launcher-create').click()");
    await until(() => desktop.registry.activeSessionId !== a && desktop.registry.snapshot().activeSession?.status === "ready", "Project B New through shared Header");
    const b = desktop.registry.activeSessionId!;
    await desktop.registry.sendPrompt(b, "commit project B", []);
    await until(() => desktop.registry.sessionView(b)?.status === "ready", "Project B committed");
    assert.equal(desktop.registry.snapshot().sessions.length, 2);
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Session actions\"]').click()");
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('.session-menu'))"), "session actions menu opens");
    const actions = await browser.executeJavaScript("document.querySelector('.session-menu').textContent") as string;
    assert.doesNotMatch(actions, /Export diagnostics|Open in editor tab/);
    await browser.executeJavaScript("[...document.querySelectorAll('.session-menu button')].find(b=>b.textContent.includes('Network & proxy')).click()");
    await until(() => browser.executeJavaScript("document.activeElement?.id==='setting-frostpi.network.proxy.mode'"), "shared proxy menu focuses Desktop proxy mode");
    await closeSettings(browser);
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Session actions\"]').click()");
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('.session-submenu-trigger'))"), "extensions menu entry appears");
    await browser.executeJavaScript("document.querySelector('.session-submenu-trigger').click()");
    await until(() => browser.executeJavaScript("[...document.querySelectorAll('.session-menu button')].some(b=>b.textContent.includes('Question tool'))"), "Question tool entry appears");
    await browser.executeJavaScript("[...document.querySelectorAll('.session-menu button')].find(b=>b.textContent.includes('Question tool')).click()");
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), "shared Question tool menu opens Desktop settings");
    await closeSettings(browser);
    const resume = desktop.registry.resumeSession();
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('dialog .codicon-folder-opened'))"), "native QuickPick icon-label rendering");
    const labelRendering: unknown = await browser.executeJavaScript("({rawMarker:document.querySelector('dialog').textContent.includes('$('),glyph:getComputedStyle(document.querySelector('dialog .codicon-folder-opened'),'::before').content!=='none'})");
    assert.deepEqual(labelRendering, { rawMarker: false, glyph: true });
    await browser.executeJavaScript("document.querySelector('dialog footer button').click()");
    await resume;
    await Promise.all([desktop.registry.sendPrompt(a, "stream-084", []), desktop.registry.sendPrompt(b, "stream-084", [])]);
    await until(() => desktop.registry.sessionView(a)?.status === "running" && desktop.registry.sessionView(b)?.status === "running", "both Pi actively stream");
    await browser.executeJavaScript(`window.frostpiDesktop.settings({type:'save',values:${JSON.stringify({
      ...settingsStore.values,
      "frostpi.pi.executable": join(directory, "not-a-pi-executable"),
      "frostpi.network.proxy.mode": "direct",
      "chat.fontFamily": "Arial",
      "chat.fontSize": 18,
      "chat.editor.fontFamily": "Courier New",
      "chat.editor.fontSize": 16,
    })}})`);
    assert.equal(desktop.registry.sessionView(a)?.status, "running");
    assert.equal(desktop.registry.sessionView(b)?.status, "running");
    assert.equal(desktop.registry.sessionView(a)?.networkProxy.restartRequired, true);
    await desktop.registry.abort(a);
    await until(() => !desktop.registry.sessionView(a)?.isStreaming, "target Pi stops");
    assert.equal(desktop.registry.sessionView(b)?.status, "running");
    await writeFile(join(directory, "release-stream"), "finish");
    await until(() => desktop.registry.sessionView(b)?.status === "ready", "other Pi remains live after Stop");
    await browser.executeJavaScript(`window.frostpiDesktop.postClientMessage({type:'activateSession',sessionId:${JSON.stringify(a)},bridgeVersion:${JSON.stringify((await import("@frostime/pi-client/shared/bridge/bridgeVersion")).BRIDGE_VERSION)}})`);
    await until(() => desktop.registry.activeSessionId === a, "foreground Pi switch");
    assert.equal(desktop.registry.sessionView(a)?.cwd, projectA!.cwd);
    assert.equal(desktop.registry.sessionView(b)?.cwd, projectB!.cwd);
    // Changing executable/proxy above must not replace either already running child.
    await desktop.registry.sendPrompt(a, "typography", []);
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('.markdown-body pre code'))"), "real shared Markdown code block");
    const fonts: unknown = await browser.executeJavaScript(`(() => {
      const style = (selector) => { const s = getComputedStyle(document.querySelector(selector)); return {family:s.fontFamily,size:s.fontSize}; };
      return {message:style('.message-content'),composer:style('.prompt-editor .cm-scroller'),code:style('.markdown-body pre code')};
    })()`);
    assert.deepEqual(fonts, {
      message: { family: "Arial", size: "18px" },
      composer: { family: '"Courier New"', size: "16px" },
      code: { family: '"Courier New"', size: "18px" },
    });
    const resetFonts: Record<string, unknown> = { ...settingsStore.values, "editor.fontFamily": "Cascadia Code, monospace" };
    delete resetFonts["chat.editor.fontFamily"];
    await browser.executeJavaScript(`window.frostpiDesktop.settings({type:'save',values:${JSON.stringify(resetFonts)}})`);
    await until(() => browser.executeJavaScript("getComputedStyle(document.querySelector('.markdown-body pre code')).fontFamily.includes('Cascadia Code')"), "editor.fontFamily fallback reaches shared code text");
    assert.equal(await browser.executeJavaScript("getComputedStyle(document.querySelector('.markdown-body pre code')).fontSize"), "18px");
    assert.notEqual(await browser.executeJavaScript("getComputedStyle(document.querySelector('.prompt-editor .cm-scroller')).fontFamily"), '"Cascadia Code", monospace');
    await desktop.registry.sendPrompt(a, "mermaid", []);
    await until(() => browser.executeJavaScript("Boolean(document.querySelector('.mermaid-host svg'))"), "shared Mermaid renders from packaged vendor resource");
    const diagramText: unknown = await browser.executeJavaScript("document.querySelector('.mermaid-host svg').textContent");
    assert.equal(typeof diagramText, "string");
    assert.match(String(diagramText), /Shared/);
    assert.match(String(diagramText), /Desktop/);
    const security: unknown = await browser.executeJavaScript("({node:typeof window.require,process:typeof window.process,rawIpc:typeof window.frostpiDesktop.ipcRenderer,editorButtons:[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Open in editor tab')).length})");
    assert.deepEqual(security, { node: "undefined", process: "undefined", rawIpc: "undefined", editorButtons: 0 });
    await until(() => browser.executeJavaScript("document.querySelectorAll('aside .pi-row').length === 2 && Boolean(document.querySelector('.mermaid-host svg'))"), "both Pi and active conversation reach the renderer");
    desktop.window.showInactive();
    await browser.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await writeFile(join(directory, "desktop.png"), (await browser.capturePage()).toPNG());
  } finally {
    await desktop.dispose();
    desktop.window.destroy();
  }
  await verifySettingsSetup();
  await verifyStartupSettingsEntries();
  await verifyDesktopStateReopen(directory, process.env.FROSTPI_DESKTOP_SMOKE_PI!, until);
  await writeFile(join(directory, "result.json"), JSON.stringify({ ok: true, projects: 2, livePi: 2, sharedUi: true, parallelExecution: true, stopIsolation: true, stableCwd: true, rendererIsolated: true, quickPickIcons: true, mermaid: true, typography: true, noImplicitRestart: true, settingsImportSaveReopen: true, sharedSettingsEntryPoints: true, actualDesktopCapabilities: true, stateReopen: true, selectedOnlyAutoStart: true, savedNullSelection: true, shutdownFlush: true }));
  app.exit(0);
}).catch((error: unknown) => {
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Smoke failure" }));
  app.exit(1);
});
