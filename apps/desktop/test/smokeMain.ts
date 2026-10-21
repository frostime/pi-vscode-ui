import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";
import { createDesktopApp } from "../src/main/createDesktopApp.js";

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

void app.whenReady().then(async () => {
  const desktop = await createDesktopApp({
    directories: [join(directory, "project-a"), join(directory, "project-b")], show: false,
    settings: {
      "frostpi.pi.executable": process.env.FROSTPI_DESKTOP_SMOKE_PI!,
    },
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
    await Promise.all([desktop.registry.sendPrompt(a, "stream-084", []), desktop.registry.sendPrompt(b, "stream-084", [])]);
    assert.equal(desktop.registry.sessionView(a)?.status, "running");
    assert.equal(desktop.registry.sessionView(b)?.status, "running");
    await desktop.registry.abort(a);
    assert.equal(desktop.registry.sessionView(b)?.status, "running");
    await until(() => desktop.registry.sessionView(b)?.status === "ready", "other Pi remains live after Stop");
    await browser.executeJavaScript(`window.frostpiDesktop.postClientMessage({type:'activateSession',sessionId:${JSON.stringify(a)},bridgeVersion:${JSON.stringify((await import("@frostime/pi-client/shared/bridge/bridgeVersion")).BRIDGE_VERSION)}})`);
    await until(() => desktop.registry.activeSessionId === a, "foreground Pi switch");
    assert.equal(desktop.registry.sessionView(a)?.cwd, projectA!.cwd);
    assert.equal(desktop.registry.sessionView(b)?.cwd, projectB!.cwd);
    const security: unknown = await browser.executeJavaScript("({node:typeof window.require,process:typeof window.process,rawIpc:typeof window.frostpiDesktop.ipcRenderer,editorButtons:[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Open in editor tab')).length})");
    assert.deepEqual(security, { node: "undefined", process: "undefined", rawIpc: "undefined", editorButtons: 0 });
    await until(() => browser.executeJavaScript("document.querySelectorAll('aside .pi-row').length === 2 && document.querySelector('.conversation')?.innerText.includes('Streaming')"), "both Pi and active conversation reach the renderer");
    desktop.window.showInactive();
    await browser.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await writeFile(join(directory, "desktop.png"), (await browser.capturePage()).toPNG());
    await writeFile(join(directory, "result.json"), JSON.stringify({ ok: true, projects: 2, livePi: 2, sharedUi: true, parallelExecution: true, stopIsolation: true, stableCwd: true, rendererIsolated: true }));
  } finally {
    await desktop.dispose();
    desktop.window.destroy();
  }
  app.exit(0);
}).catch((error: unknown) => {
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Smoke failure" }));
  app.exit(1);
});
