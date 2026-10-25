import assert from "node:assert/strict";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clipboard } from "electron";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

export async function verifySettingsPanel(directory: string, waitFor: WaitFor): Promise<void> {
  const root = join(directory, "settings-panel");
  const settingsPath = join(root, "profile/settings.json");
  const settings = await DesktopSettingsStore.open(settingsPath);
  await settings.replace({ "chat.fontSize": 15, "desktop.theme": "dark" });
  const desktop = await createDesktopApp({ settingsStore: settings, stateStore: await DesktopStateStore.open(join(root, "state.json")), show: false });
  const browser = desktop.window.webContents;
  const run = (script: string) => browser.executeJavaScript(script);
  const input = async (key: string, value: string, event = "input"): Promise<void> => {
    await run(`(() => {const field=document.getElementById(${JSON.stringify(`setting-${key}`)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  };
  const search = async (text: string): Promise<void> => {
    await run(`(() => {const field=document.querySelector('[aria-label="Search settings"]');field.value=${JSON.stringify(text)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const open = async (): Promise<void> => {
    await click(".settings-button");
    await waitFor(() => run("Boolean(document.querySelector('#settings-title'))"), "grouped Settings dialog opens");
  };
  const save = async (): Promise<void> => {
    await click("dialog .save");
    await waitFor(() => run("document.querySelector('dialog .save').disabled && document.querySelector('.save-status').textContent.includes('No unsaved')"), "settings draft saves");
  };
  let copied = "";
  const writeClipboard = clipboard.writeText.bind(clipboard);
  clipboard.writeText = (text) => { copied = text; return Promise.resolve(); };
  try {
    await waitFor(() => run("Boolean(document.querySelector('.settings-button'))"), "settings fixture shell mounts");
    await open();
    assert.equal(await run("document.querySelectorAll('.categories button').length"), 4);
    assert.equal(await run("document.querySelectorAll('.group-card')[1].querySelectorAll('.setting').length"), 5);
    assert.equal(await run("document.querySelector('.setting label').textContent"), "Color theme");
    assert.equal(await run("Boolean(document.querySelector('.technical'))"), false);
    await click('[aria-label="Details for Conversation text size"]');
    assert.equal(await run("document.querySelector('.technical code').textContent"), "chat.fontSize");
    await click(".copy-key");
    await waitFor(() => copied === "chat.fontSize", "Key copy travels through the authorized client bridge");

    await input("chat.fontSize", "17");
    await click('dialog header button');
    await waitFor(() => run("Boolean(document.querySelector('[role=alertdialog]'))"), "unsaved settings close guard");
    await click('.discard-dialog button');
    assert.equal(await run("document.getElementById('setting-chat.fontSize').value"), "17");
    assert.equal(settings.values["chat.fontSize"], 15);
    await click('.categories button:nth-child(2)');
    await search("chat.fontSize");
    await waitFor(() => run("document.querySelectorAll('[data-setting-key]').length===1"), "exact Key search spans categories");
    assert.equal(await run("document.getElementById('setting-chat.fontSize').value"), "17");
    await click('button.review');
    assert.match(await run("document.querySelector('.changes').textContent") as string, /Conversation text size/);
    await click('dialog .footer-actions > button:not(.review):not(.save)');
    assert.equal(await run("document.getElementById('setting-chat.fontSize').value"), "15");

    await search("frostpi.attachments.maxImageBytes");
    await waitFor(() => run("Boolean(document.getElementById('setting-frostpi.attachments.maxImageBytes'))"), "image size search");
    assert.equal(await run("document.getElementById('setting-frostpi.attachments.maxImageBytes').value"), "10");
    await input("frostpi.attachments.maxImageBytes", "12");
    await save();
    assert.equal(settings.values["frostpi.attachments.maxImageBytes"], 12 * 1024 * 1024);

    await search("files.exclude");
    await waitFor(() => run("document.querySelector('[data-setting-key=\"files.exclude\"]')!==null"), "exclusion override search");
    await click('[data-setting-key="files.exclude"] .edit-structure');
    assert.equal(await run("document.getElementById('setting-files.exclude').value"), "{}");
    await input("files.exclude", '{"**/.git":false}');
    await save();
    assert.deepEqual(settings.values["files.exclude"], { "**/.git": false });
    assert.equal(Object.hasOwn(settings.values, "search.exclude"), false);

    await click('.categories button:nth-child(3)');
    await waitFor(() => run("Boolean(document.getElementById('setting-frostpi.network.proxy.mode'))"), "Network and file groups render together");
    assert.equal(await run("Boolean(document.getElementById('setting-frostpi.network.proxy.endpoint'))"), false);
    await input("frostpi.network.proxy.mode", "custom", "change");
    await waitFor(() => run("Boolean(document.getElementById('setting-frostpi.network.proxy.endpoint'))"), "custom proxy reveals address");
    assert.equal(await run("Boolean(document.querySelector('[data-setting-key=\"frostpi.network.proxy.mode\"] .customized'))"), true);
    await click('dialog .save');
    await waitFor(() => run("document.querySelector('.field-error')?.textContent.includes('Enter a proxy address')"), "missing proxy address is explained inline");
    assert.equal(settings.values["frostpi.network.proxy.mode"], undefined);
    await click('dialog .footer-actions > button:not(.review):not(.save)');

    await search("chat.fontSize");
    await waitFor(() => run("Boolean(document.getElementById('setting-chat.fontSize'))"), "font retry field");
    await input("chat.fontSize", "18");
    // This is our throwaway profile only. Make a write fail, then restore the
    // exact directory so the user can retry the still-visible form draft.
    const folder = dirname(settingsPath);
    const backup = join(root, "profile-backup");
    await rename(folder, backup);
    await writeFile(folder, "blocked fixture directory");
    await click('dialog .save');
    await waitFor(() => run("document.querySelector('.error.notice')?.textContent.includes('Cannot save Desktop settings')"), "failed Save stays visible");
    assert.equal(await run("document.getElementById('setting-chat.fontSize').value"), "18");
    assert.equal(settings.values["chat.fontSize"], 15);
    await unlink(folder);
    await rename(backup, folder);
    await save();
    assert.equal(settings.values["chat.fontSize"], 18);

    await writeFile(settingsPath, "{ broken }");
    await click('.file-menu summary');
    await click('.file-actions button:last-child');
    await waitFor(() => run("document.querySelector('.error.notice')?.textContent.includes('Cannot read Desktop settings')"), "bad-file recovery view");
    assert.equal(await run("document.querySelector('dialog .save').disabled"), true);
    assert.equal(await readFile(settingsPath, "utf8"), "{ broken }");
    await writeFile(settingsPath, '{"desktop.theme":"dark","chat.fontSize":20}');
    await click('.file-actions button:last-child');
    await waitFor(() => run("document.getElementById('setting-chat.fontSize')?.value==='20'"), "Reload reads the externally repaired file");
    assert.equal(await run("Boolean(document.querySelector('.error.notice'))"), false);
    await click('.file-menu summary');
    await click('.categories button:first-child');
    desktop.window.showInactive();
    await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await writeFile(join(directory, "desktop-settings-grouped.png"), (await browser.capturePage()).toPNG());
    await click('[aria-label="Details for Conversation text size"]');
    desktop.window.setSize(280, 700);
    await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.deepEqual(await run(`(() => {
      const dialog=document.querySelector('dialog'),body=document.querySelector('.settings-body');
      return {dialog:dialog.scrollWidth<=dialog.clientWidth+1,body:body.scrollWidth<=body.clientWidth+1,mobile:getComputedStyle(document.querySelector('.mobile-category')).display!=='none'};
    })()`), { dialog: true, body: true, mobile: true });
    await writeFile(join(directory, "desktop-settings-grouped-280.png"), (await browser.capturePage()).toPNG());
  } finally {
    clipboard.writeText = writeClipboard;
    await desktop.dispose(); desktop.window.destroy();
  }
}
