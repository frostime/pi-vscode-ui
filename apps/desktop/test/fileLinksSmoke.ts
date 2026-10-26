import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shell } from "electron";
import type { createDesktopApp } from "../src/main/createDesktopApp.js";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

/** Real Markdown clicks and validated IPC, with only external application launches intercepted. */
export async function verifyDesktopFileLinks(desktop: Awaited<ReturnType<typeof createDesktopApp>>, waitFor: WaitFor): Promise<void> {
  const browser = desktop.window.webContents;
  const sessionId = desktop.registry.activeSessionId!;
  const cwd = await realpath(desktop.registry.sessionView(sessionId)!.cwd);
  const script = join(cwd, "link-script.ps1");
  const document = join(cwd, "link-note.md");
  const folder = join(cwd, "link-folder");
  await writeFile(script, "# synthetic, never execute");
  await writeFile(document, "Synthetic document");
  await mkdir(folder);
  await writeFile(join(cwd, "link-denied.cmd"), "never execute");
  const openedUrls: string[] = [];
  const openedPaths: string[] = [];
  const openExternal = shell.openExternal.bind(shell);
  const openPath = shell.openPath.bind(shell);
  shell.openExternal = (url) => { openedUrls.push(url); return Promise.resolve(); };
  shell.openPath = (path) => { openedPaths.push(path); return Promise.resolve(""); };
  try {
    const content = "[Link script](./link-script.ps1:7:3) · [Link note](./link-note.md) · [Link folder](./link-folder/) · [Link denied](./link-denied.cmd) · [Link website](https://example.com/desktop-links)";
    await desktop.registry.sendPrompt(sessionId, content, []);
    await waitFor(() => browser.executeJavaScript("Boolean([...document.querySelectorAll('.markdown-body a')].find(a=>a.textContent==='Link script')?.getAttribute('href'))"), "Desktop enables real Markdown file references");
    const click = (label: string): Promise<unknown> => browser.executeJavaScript(`[...document.querySelectorAll('.markdown-body a')].find(a=>a.textContent===${JSON.stringify(label)}).click()`);
    await click("Link script");
    await waitFor(() => openedUrls.length === 1, "script click reaches the VS Code opener");
    const uri = new URL(openedUrls[0]!);
    assert.equal(uri.protocol, "vscode:");
    assert.equal(uri.hostname, "file");
    assert.equal(decodeURIComponent(uri.pathname).endsWith("/link-script.ps1:7:3"), true);
    assert.deepEqual(openedPaths, []);
    await click("Link note");
    await waitFor(() => openedPaths.length === 1, "document click reaches its default application");
    assert.equal(openedPaths[0], document);
    const projects = desktop.projects.list().map(({ id }) => id);
    await click("Link folder");
    await waitFor(() => openedPaths.length === 2, "directory click reaches the file manager");
    assert.equal(openedPaths[1], folder);
    assert.deepEqual(desktop.projects.list().map(({ id }) => id), projects);
    await click("Link website");
    await waitFor(() => openedUrls.length === 2, "HTTP(S) links retain the default-browser route");
    assert.equal(openedUrls[1], "https://example.com/desktop-links");
    await click("Link denied");
    await waitFor(() => browser.executeJavaScript("document.body.innerText.includes('This file type is not supported for Desktop links.')"), "main rejects an explicit link outside the whitelist");
    assert.deepEqual(openedPaths, [document, folder]);
    assert.equal(openedUrls.length, 2);
    await browser.executeJavaScript(`window.frostpiDesktop.postClientMessage(${JSON.stringify({ type: "openExternal", url: "vscode://file/not-authorized", bridgeVersion: BRIDGE_VERSION })})`);
    await waitFor(() => browser.executeJavaScript("document.body.innerText.includes('Only HTTP(S) links can be opened.')"), "raw application protocols remain rejected");
    assert.equal(openedUrls.length, 2);
    assert.equal(desktop.registry.activeSessionId, sessionId);
    assert.equal(await browser.executeJavaScript("typeof window.require"), "undefined");
  } finally {
    shell.openExternal = openExternal;
    shell.openPath = openPath;
  }
}
