import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverSessionWorkingDirectories } from "@frostime/pi-client/host";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

/** Real Desktop UI + shared Resume, with discovery held before any Runtime exists. */
export async function verifyDesktopResume(directory: string, executable: string, waitFor: WaitFor): Promise<void> {
  const root = join(directory, "resume-ui");
  const projectRoot = join(root, "project");
  const sessionsRoot = join(root, "sessions");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(join(sessionsRoot, "resume-smoke.jsonl"), [
    { type: "session", version: 3, id: "resume-smoke", cwd: projectRoot, timestamp: new Date().toISOString() },
    { type: "session_info", id: "name", parentId: null, name: "Resume UI fixture" },
    { type: "message", id: "message", parentId: "name", message: { role: "user", content: "Synthetic resumed history", timestamp: Date.now() } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const settings = await DesktopSettingsStore.open(join(root, "settings.json"));
  await settings.replace({
    "frostpi.pi.executable": executable,
    "frostpi.pi.arguments": ["--session-dir", sessionsRoot, "--persist-session-fixture"],
    "frostpi.session.startOnOpen": false,
  });
  let releaseDiscovery = (): void => undefined;
  const heldDiscovery = new Promise<void>((resolve) => { releaseDiscovery = resolve; });
  let mode: "hold" | "normal" | "fail" = "hold";
  const desktop = await createDesktopApp({
    directories: [projectRoot], settingsStore: settings,
    stateStore: await DesktopStateStore.open(join(root, "state.json")), show: false,
    discoverWorkingDirectories: async (...args) => {
      if (mode === "hold") await heldDiscovery;
      if (mode === "fail") throw new Error("Controlled session discovery failure.");
      return discoverSessionWorkingDirectories(...args);
    },
  });
  const browser = desktop.window.webContents;
  const start = async (): Promise<void> => {
    await browser.executeJavaScript("[...document.querySelectorAll('.onboarding-actions button')].find(b=>b.textContent.includes('Resume session')).click()");
  };
  try {
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.onboarding-actions'))"), "Resume empty-state entry");
    await start();
    await waitFor(() => browser.executeJavaScript("document.querySelector('#resume-title')?.textContent==='Looking for saved sessions'"), "immediate Resume feedback before directory discovery finishes");
    assert.equal(desktop.registry.snapshot().sessions.length, 0);
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('.resume-activity'))"), true);
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('dialog'))"), false);
    releaseDiscovery(); mode = "normal";
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.resume-choice'))"), "session choices replace the discovery activity");
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('.resume-activity'))"), false);
    assert.equal(await browser.executeJavaScript("document.querySelector('.resume-search input')===document.activeElement"), true);
    assert.equal(await browser.executeJavaScript("document.querySelector('.resume-card').textContent.includes('Resume UI fixture')"), true);
    desktop.window.setSize(280, 700);
    await browser.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.deepEqual(await browser.executeJavaScript(`(() => {
      const c=document.querySelector('.resume-card');const r=c.getBoundingClientRect();
      return {fits:r.left>=0&&r.right<=innerWidth,noHorizontalScroll:c.scrollWidth<=c.clientWidth+1};
    })()`), { fits: true, noHorizontalScroll: true });
    desktop.window.showInactive();
    await writeFile(join(directory, "desktop-resume-280.png"), (await browser.capturePage()).toPNG());
    await browser.executeJavaScript("document.querySelector('.resume-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitFor(() => browser.executeJavaScript("!document.querySelector('.resume-overlay')"), "selection cancellation cleans up the overlay");
    assert.equal(desktop.registry.snapshot().sessions.length, 0);

    // No valid bridge version means no Resume operation, including no overlay.
    await browser.executeJavaScript("window.frostpiDesktop.postClientMessage({type:'resumeSession',bridgeVersion:'invalid'})");
    await browser.executeJavaScript("new Promise(resolve=>setTimeout(resolve,100))");
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('.resume-overlay'))"), false);

    mode = "fail";
    await start();
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.resume-error'))"), "Resume failure remains visible without a Runtime");
    assert.equal(await browser.executeJavaScript("document.querySelector('.resume-error').textContent"), "Controlled session discovery failure.");
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('.resume-activity'))"), false);
    await browser.executeJavaScript("[...document.querySelectorAll('.resume-card footer button')].find(b=>b.textContent==='Close').click()");
    await waitFor(() => browser.executeJavaScript("!document.querySelector('.resume-overlay')"), "failure dismissal clears only its Resume view");

    mode = "normal";
    desktop.window.setSize(1100, 800);
    await start();
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.resume-choice'))"), "success picker opens");
    await browser.executeJavaScript("[...document.querySelectorAll('.resume-choice')].find(b=>b.textContent.includes('Resume UI fixture')).click()");
    await waitFor(() => desktop.registry.snapshot().activeSession?.historyStatus === "loaded", "shared Resume really loads the synthetic Pi history");
    await waitFor(() => browser.executeJavaScript("!document.querySelector('.resume-overlay') && document.body.innerText.includes('Synthetic resumed history')"), "Resume completion hands back the same shared ClientApp");
    assert.equal(desktop.registry.snapshot().sessions.length, 1);
  } finally {
    releaseDiscovery();
    await desktop.dispose();
    if (!desktop.window.isDestroyed()) desktop.window.destroy();
  }
}
