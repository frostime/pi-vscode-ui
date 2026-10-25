import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

/** Switch the real shared conversation, editor, highlighted code and Mermaid. */
export async function verifyDesktopThemes(desktop: Awaited<ReturnType<typeof createDesktopApp>>, directory: string, waitFor: WaitFor): Promise<void> {
  const browser = desktop.window.webContents;
  const diagramFill = (): Promise<string> => browser.executeJavaScript("getComputedStyle(document.querySelector('.mermaid-host svg .node rect')).fill");
  const darkFill = await diagramFill();
  assert.equal(await browser.executeJavaScript("document.documentElement.dataset.desktopTheme"), "dark");
  assert.notEqual(await browser.executeJavaScript("getComputedStyle(document.querySelector('.theme-button .codicon'),'::before').content"), "none");
  const sessions = desktop.registry.snapshot().sessions.map(({ id, status }) => ({ id, status }));
  await browser.executeJavaScript(`
    window.__themeClient=document.querySelector('.frostpi-root');
    window.__themeEditor=document.querySelector('.cm-editor');
    window.__themeDraft=document.querySelector('.cm-content').textContent;
    document.querySelector('[aria-label="Switch to Light Modern"]').click();
  `);
  await waitFor(() => browser.executeJavaScript("document.documentElement.dataset.desktopTheme==='light' && Boolean(document.querySelector('.mermaid-host svg .node rect'))"), "light palette and diagram render");
  await waitFor(async () => (await diagramFill()) !== darkFill, "mounted Mermaid changes its embedded colors");
  assert.equal(desktop.settingsStore.values["desktop.theme"], "light");
  assert.deepEqual(await browser.executeJavaScript(`(() => {
    const css=getComputedStyle(document.documentElement);
    return {
      scheme:css.colorScheme,
      background:getComputedStyle(document.querySelector('.frostpi-root')).backgroundColor,
      keyword:getComputedStyle(document.querySelector('.hljs-keyword')).color,
      sameClient:window.__themeClient===document.querySelector('.frostpi-root'),
      sameEditor:window.__themeEditor===document.querySelector('.cm-editor'),
      sameDraft:window.__themeDraft===document.querySelector('.cm-content').textContent,
    };
  })()`), { scheme: "light", background: "rgb(255, 255, 255)", keyword: "rgb(175, 0, 219)", sameClient: true, sameEditor: true, sameDraft: true });
  assert.deepEqual(desktop.registry.snapshot().sessions.map(({ id, status }) => ({ id, status })), sessions);
  await browser.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await writeFile(join(directory, "desktop-light-modern.png"), (await browser.capturePage()).toPNG());

  await browser.executeJavaScript("document.querySelector('.settings-button').click()");
  await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), "light Settings panel");
  assert.equal(await browser.executeJavaScript("getComputedStyle(document.querySelector('dialog')).color"), "rgb(59, 59, 59)");
  assert.equal(await browser.executeJavaScript("getComputedStyle(document.querySelector('dialog select')).colorScheme"), "light");
  await writeFile(join(directory, "desktop-light-modern-settings.png"), (await browser.capturePage()).toPNG());
  await browser.executeJavaScript("document.querySelector('dialog header button').click()");
  await waitFor(() => browser.executeJavaScript("!document.querySelector('#settings-title')"), "light Settings closes");

  await browser.executeJavaScript("document.querySelector('[aria-label=\"Switch to Dark Modern\"]').click()");
  await waitFor(() => browser.executeJavaScript("document.documentElement.dataset.desktopTheme==='dark' && Boolean(document.querySelector('.mermaid-host svg .node rect'))"), "dark palette returns");
  await waitFor(async () => (await diagramFill()) === darkFill, "dark diagram cache returns its matching SVG");
  assert.equal(await browser.executeJavaScript("getComputedStyle(document.documentElement).colorScheme"), "dark");
  await writeFile(join(directory, "desktop-dark-modern.png"), (await browser.capturePage()).toPNG());

  desktop.window.setSize(280, 700);
  await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.narrow==='true'"), "narrow Desktop layout");
  await browser.executeJavaScript("document.querySelector('[aria-label=\"Open the Projects drawer\"]').click()");
  await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.drawer==='open'"), "narrow theme control is reachable");
  await browser.executeJavaScript("document.querySelector('[aria-label=\"Switch to Light Modern\"]').click()");
  await waitFor(() => browser.executeJavaScript("document.documentElement.dataset.desktopTheme==='light'"), "narrow theme switch");
  await browser.executeJavaScript("Promise.all(document.querySelector('.sidebar').getAnimations().map(animation=>animation.finished))");
  assert.equal(await browser.executeJavaScript(`(() => {
    const r=document.querySelector('.theme-button').getBoundingClientRect();
    return r.left>=0 && r.right<=innerWidth;
  })()`), true);
  await browser.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await writeFile(join(directory, "desktop-light-modern-280.png"), (await browser.capturePage()).toPNG());
  await browser.executeJavaScript("document.querySelector('.drawer-scrim').click()");
  desktop.window.setSize(1100, 800);
}

export async function verifyDesktopThemeReopen(directory: string, waitFor: WaitFor): Promise<void> {
  // Reuse the actual setting saved by the sidebar toggle, but no Session fixture
  // is needed to prove that the next window starts in the selected palette.
  const settingsStore = await DesktopSettingsStore.open(join(directory, "electron-profile/settings.json"));
  const desktop = await createDesktopApp({ settingsStore, stateStore: await DesktopStateStore.open(join(directory, "theme-reopen/state.json")), show: false });
  try {
    await waitFor(() => desktop.window.webContents.executeJavaScript("Boolean(document.querySelector('.frostpi-root'))"), "theme-reopen client mount");
    assert.equal(await desktop.window.webContents.executeJavaScript("document.documentElement.dataset.desktopTheme"), "light");
    assert.equal(desktop.window.getBackgroundColor().toLowerCase(), "#f8f8f8");
    assert.equal(await desktop.window.webContents.executeJavaScript("Boolean(document.querySelector('#settings-title'))"), false);
  } finally {
    await desktop.dispose(); desktop.window.destroy();
  }
}
