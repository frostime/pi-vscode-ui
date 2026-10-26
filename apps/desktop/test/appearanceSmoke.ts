import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { screen, type WebContents } from "electron";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

function edit(browser: WebContents, key: string, value: string): Promise<unknown> {
  return browser.executeJavaScript(`(() => {
    const field=document.getElementById(${JSON.stringify(`setting-${key}`)});
    field.value=${JSON.stringify(value)};
    field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
function zoomKey(browser: WebContents, keyCode: string): void {
  const modifiers: Array<"meta" | "control"> = [process.platform === "darwin" ? "meta" : "control"];
  browser.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  browser.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

/** Native menu/keyboard/zoom and real UI fonts, without replacing the mounted client or draft. */
export async function verifyDesktopAppearance(desktop: Awaited<ReturnType<typeof createDesktopApp>>, directory: string, waitFor: WaitFor): Promise<void> {
  const browser = desktop.window.webContents;
  assert.equal(desktop.window.isMenuBarVisible(), false);
  assert.equal(browser.getZoomMode(), "isolated");
  const initialViewport = await browser.executeJavaScript("({width:innerWidth,dpr:devicePixelRatio})") as { width: number; dpr: number };
  await desktop.settingsStore.update("chat.editor.fontFamily", "Courier New");
  await waitFor(() => browser.executeJavaScript("getComputedStyle(document.querySelector('.cm-scroller')).fontFamily.includes('Courier New')"), "explicit Composer font baseline");
  const sessions = desktop.registry.snapshot().sessions.map(({ id, status }) => ({ id, status }));
  await browser.executeJavaScript(`
    window.__appearanceClient=document.querySelector('.frostpi-root');
    window.__appearanceEditor=document.querySelector('.cm-editor');
    window.__appearanceDraft=document.querySelector('.cm-content').textContent;
    document.querySelector('.settings-button').click();
  `);
  await waitFor(() => browser.executeJavaScript("Boolean(document.getElementById('setting-desktop.ui.fontSize'))"), "Appearance exposes independent interface typography and Zoom");
  await edit(browser, "desktop.ui.fontFamily", "Georgia, serif");
  await edit(browser, "desktop.ui.fontSize", "18");
  await edit(browser, "desktop.zoomFactor", "125");
  assert.equal(browser.getZoomFactor(), 1);
  assert.equal(await browser.executeJavaScript("getComputedStyle(document.querySelector('.project-name')).fontSize"), "12px");
  await waitFor(() => browser.executeJavaScript("!document.querySelector('dialog .save').disabled"), "appearance draft is ready to save");
  await browser.executeJavaScript("document.querySelector('dialog .save').click()");
  await waitFor(async () => Math.abs(browser.getZoomFactor() - 1.25) < 1e-6
    && (await browser.executeJavaScript(`Math.abs(devicePixelRatio/${initialViewport.dpr}-1.25)<1e-6 && Math.abs(innerWidth*1.25-${initialViewport.width})<=2`)) === true, "Save really scales the page, not just the reported Zoom factor");
  await waitFor(() => browser.executeJavaScript("getComputedStyle(document.querySelector('.project-name')).fontSize==='17px'"), "Project text follows the interface size token");
  assert.deepEqual(await browser.executeJavaScript(`(() => {
    const style=s=>getComputedStyle(document.querySelector(s));
    return {
      uiFamily:style('.project-name').fontFamily,
      settingsLabel:style('label[for="setting-desktop.ui.fontSize"]').fontSize,
      chip:style('.composer-chip').fontSize,
      messageFamily:style('.message-content').fontFamily,
      messageSize:style('.message-content').fontSize,
      editorFamily:style('.cm-scroller').fontFamily,
      editorSize:style('.cm-scroller').fontSize,
      sameClient:window.__appearanceClient===document.querySelector('.frostpi-root'),
      sameEditor:window.__appearanceEditor===document.querySelector('.cm-editor'),
      sameDraft:window.__appearanceDraft===document.querySelector('.cm-content').textContent,
    };
  })()`), { uiFamily: "Georgia, serif", settingsLabel: "18px", chip: "17px", messageFamily: "Arial", messageSize: "18px", editorFamily: '"Courier New"', editorSize: "16px", sameClient: true, sameEditor: true, sameDraft: true });
  assert.deepEqual(desktop.registry.snapshot().sessions.map(({ id, status }) => ({ id, status })), sessions);
  await writeFile(join(directory, "desktop-interface-settings.png"), (await browser.capturePage()).toPNG());

  // Keyboard Zoom updates untouched fields even while another setting is being edited.
  await edit(browser, "chat.fontSize", "22");
  zoomKey(browser, "=");
  await waitFor(() => desktop.settingsStore.values["desktop.zoomFactor"] === 1.35, "hidden-menu Ctrl/Cmd + persists Zoom");
  await waitFor(() => browser.executeJavaScript("document.getElementById('setting-desktop.zoomFactor').value==='135'"), "open settings reflect the Zoom shortcut");
  assert.equal(await browser.executeJavaScript("document.getElementById('setting-chat.fontSize').value"), "22");
  await browser.executeJavaScript("document.querySelector('dialog .save').click()");
  await waitFor(() => desktop.settingsStore.values["chat.fontSize"] === 22, "Save retains the edited chat size and the external Zoom update");
  assert.equal(desktop.settingsStore.values["desktop.zoomFactor"], 1.35);
  zoomKey(browser, "0");
  await waitFor(() => desktop.settingsStore.values["desktop.zoomFactor"] === undefined && Math.abs(browser.getZoomFactor() - 1) < 1e-6, "Ctrl/Cmd 0 removes the Zoom override");
  zoomKey(browser, "-");
  await waitFor(() => desktop.settingsStore.values["desktop.zoomFactor"] === 0.9, "Ctrl/Cmd - persists Zoom out");
  await waitFor(() => browser.executeJavaScript("document.getElementById('setting-desktop.zoomFactor').value==='90'"), "settings reflect Zoom out");
  await edit(browser, "desktop.zoomFactor", "125");
  await edit(browser, "desktop.ui.fontSize", "24");
  await browser.executeJavaScript("document.querySelector('dialog .save').click()");
  await waitFor(() => desktop.settingsStore.values["desktop.ui.fontSize"] === 24 && Math.abs(browser.getZoomFactor() - 1.25) < 1e-6, "large UI font and saved Zoom");
  desktop.window.setSize(360, 900);
  await waitFor(() => browser.executeJavaScript("innerWidth<=280 && document.querySelector('.desktop-shell').dataset.narrow==='true'"), "large fonts in a narrow window");
  assert.equal(await browser.executeJavaScript(`(() => {
    const d=document.querySelector('.settings-dialog');
    const save=d.querySelector('.save').getBoundingClientRect();
    const close=d.querySelector('.close').getBoundingClientRect();
    return d.scrollWidth<=d.clientWidth+1 && save.right<=innerWidth && save.left>=0 && close.right<=innerWidth;
  })()`), true);
  await writeFile(join(directory, "desktop-interface-settings-280.png"), (await browser.capturePage()).toPNG());
  await browser.executeJavaScript("document.querySelector('dialog header .close').click()");
  await waitFor(() => browser.executeJavaScript("!document.querySelector('#settings-title')"), "large Settings remains closable");
  await browser.executeJavaScript("document.querySelector('[aria-label=\"Open the Projects drawer\"]').click()");
  await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.drawer==='open'"), "large-font Projects remain reachable");
  await browser.executeJavaScript("Promise.all(document.querySelector('.sidebar').getAnimations().map(animation=>animation.finished))");
  assert.equal(await browser.executeJavaScript(`(() => {
    const p=document.querySelector('.project-name');
    const b=document.querySelector('.settings-button').getBoundingClientRect();
    return getComputedStyle(p).fontSize==='23px' && b.right<=innerWidth && b.left>=0;
  })()`), true);
  await writeFile(join(directory, "desktop-interface-projects-280.png"), (await browser.capturePage()).toPNG());
  await browser.executeJavaScript("document.querySelector('.drawer-scrim').click()");
  desktop.window.setSize(1100, 800);
  await desktop.settingsStore.update("desktop.ui.fontSize", 18);
}

export async function verifyDesktopAppearanceReopen(directory: string, waitFor: WaitFor): Promise<void> {
  const settingsStore = await DesktopSettingsStore.open(join(directory, "electron-profile/settings.json"));
  const desktop = await createDesktopApp({ settingsStore, stateStore: await DesktopStateStore.open(join(directory, "appearance-reopen/state.json")), show: false });
  try {
    const browser = desktop.window.webContents;
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.frostpi-root'))"), "appearance-reopen client");
    assert.equal(desktop.window.isMenuBarVisible(), false);
    assert.ok(Math.abs(browser.getZoomFactor() - 1.25) < 1e-6);
    const systemScale = screen.getDisplayMatching(desktop.window.getBounds()).scaleFactor;
    assert.ok(Math.abs(Number(await browser.executeJavaScript("devicePixelRatio")) - systemScale * 1.25) < 1e-6);
    assert.deepEqual(await browser.executeJavaScript("({size:getComputedStyle(document.documentElement).getPropertyValue('--vscode-font-size'),family:getComputedStyle(document.body).fontFamily})"), { size: "18px", family: "Georgia, serif" });
  } finally {
    await desktop.dispose(); desktop.window.destroy();
  }
}
