import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog } from "electron";
import { createDesktopApp } from "../src/main/createDesktopApp.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopStateStore } from "../src/main/storage/DesktopStateStore.js";

type WaitFor = (check: () => boolean | Promise<boolean>, label: string) => Promise<void>;

/** Exercise Project scope through the real shared UI, preserving one ClientApp. */
export async function verifyProjectNavigation(directory: string, executable: string, waitFor: WaitFor): Promise<void> {
  const root = join(directory, "project-navigation");
  const aRoot = join(root, "repository");
  const bRoot = join(root, "linked-worktree");
  const cRoot = join(root, "new-project");
  await Promise.all([aRoot, bRoot, cRoot].map((path) => mkdir(path, { recursive: true })));
  const settingsPath = join(root, "settings.json");
  const statePath = join(root, "state.json");
  const settings = await DesktopSettingsStore.open(settingsPath);
  await settings.replace({ "frostpi.pi.executable": executable, "frostpi.pi.arguments": ["--persist-session-fixture"] });
  const discoverWorkingDirectories = (cwd: string) => Promise.resolve({
    authoritative: true,
    directories: [cwd, cwd === aRoot ? bRoot : aRoot].map((path, index) => ({
      cwd: path, workspaceFolderCwd: cwd, directoryName: index === 0 ? "Current" : "Linked worktree", isCurrent: index === 0,
    })),
  });
  const desktop = await createDesktopApp({
    directories: [aRoot, bRoot], settingsStore: settings,
    stateStore: await DesktopStateStore.open(statePath), discoverWorkingDirectories, show: false,
  });
  const browser = desktop.window.webContents;
  const [a, b] = desktop.projects.list();
  let session = "";
  const chooseProject = async (cwd: string): Promise<void> => {
    await browser.executeJavaScript(`[...document.querySelectorAll('.project-select')].find(button=>button.title===${JSON.stringify(cwd)}).click()`);
  };
  const frames = () => browser.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const checkProjectBar = async (): Promise<void> => {
    await frames();
    assert.deepEqual(await browser.executeJavaScript(`(() => {
      const bar=document.querySelector('.project-bar');
      const b=bar.getBoundingClientRect();
      const context=document.querySelector('.project-context').getBoundingClientRect();
      const name=document.querySelector('.context-name').getBoundingClientRect();
      const path=document.querySelector('.context-path').getBoundingClientRect();
      const icon=document.querySelector('.context-heading .codicon').getBoundingClientRect();
      const toggle=document.querySelector('.project-bar > .bar-button').getBoundingClientRect();
      return {
        rightAligned:Math.abs(context.right-(b.right-parseFloat(getComputedStyle(bar).paddingRight)))<1,
        textAligned:Math.abs(name.right-path.right)<1,
        iconCentered:Math.abs((icon.top+icon.bottom-name.top-name.bottom)/2)<1,
        fits:context.left>=toggle.right&&bar.scrollWidth<=bar.clientWidth+1,
      };
    })()`), { rightAligned: true, textAligned: true, iconCentered: true, fits: true });
  };
  try {
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.onboarding-actions .primary'))"), "Project navigation's initial empty state");
    await browser.executeJavaScript("window.__navigationRoot=document.querySelector('.frostpi-root');document.querySelector('.onboarding-actions .primary').click()");
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('dialog .choices button'))"), "New offers the controlled linked worktree");
    await browser.executeJavaScript(`[...document.querySelectorAll('dialog .choices button')].find(button=>button.textContent.includes(${JSON.stringify(bRoot)})).click()`);
    await waitFor(() => desktop.registry.snapshot().activeSession?.status === "ready", "Pi starts in the chosen worktree");
    session = desktop.registry.activeSessionId!;
    await desktop.registry.sendPrompt(session, "Commit Project navigation fixture", []);
    await waitFor(() => desktop.registry.sessionView(session)?.status === "ready", "navigation fixture commits");
    assert.equal(desktop.registry.sessionView(session)?.cwd, b!.cwd);
    assert.equal(desktop.navigation.view.sessionProjects[session], a!.id);
    await waitFor(() => browser.executeJavaScript(`document.querySelector('.context-path')?.textContent.includes(${JSON.stringify(b!.cwd)})`), "Desktop names the actual worktree directory without changing Project ownership");
    await checkProjectBar();
    await browser.executeJavaScript("document.querySelector('.prompt-editor .cm-content').focus()");
    await browser.insertText("Unsent Project A draft");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.cm-content').textContent.includes('Unsent Project A draft')"), "real Project A draft");
    await chooseProject(b!.cwd);
    await waitFor(() => desktop.projects.selected?.id === b!.id && desktop.registry.activeSessionId === null, "worktree Project itself remains empty");
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.onboarding-actions')) && !document.querySelector('.cm-content')"), "empty Project B has no Project A editor or conversation");
    assert.equal(desktop.registry.snapshot().sessions.length, 1);
    assert.equal(await browser.executeJavaScript("window.__navigationRoot===document.querySelector('.frostpi-root')"), true);

    // Only this owned Electron process's native boundary is replaced. The renderer
    // still invokes the real Add Project IPC and cannot supply an arbitrary path.
    const original = Object.getOwnPropertyDescriptor(dialog, "showOpenDialog")!;
    Object.defineProperty(dialog, "showOpenDialog", { ...original, value: () => Promise.resolve({ canceled: false, filePaths: [cRoot] }) });
    try { await browser.executeJavaScript("document.querySelector('[aria-label=\"Add Project\"]').click()");
      await waitFor(() => desktop.projects.selected?.name === "new-project", "adding a Project immediately selects it");
    } finally { Object.defineProperty(dialog, "showOpenDialog", original); }
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.onboarding-actions .primary')) && document.querySelectorAll('.project-select').length===3"), "newly added Project stays empty without creating Pi");
    assert.equal(desktop.registry.snapshot().sessions.length, 1);

    await desktop.registry.sendPrompt(session, "navigation-needs-input", []);
    await waitFor(() => desktop.registry.sessionView(session)?.pendingExtensionUi.length === 1, "background Project needs input");
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Hide the Projects sidebar\"]').click()");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.hidden==='true' && Boolean(document.querySelector('.attention-button'))"), "hidden sidebar retains background input attention");
    await browser.executeJavaScript("document.querySelector('.attention-button').click()");
    await waitFor(() => desktop.projects.selected?.id === a!.id && desktop.registry.activeSessionId === session, "attention opens the owning Project, not the cwd-matching Project");
    await waitFor(() => browser.executeJavaScript("document.body.innerText.includes('Confirm the synthetic Project navigation check?')"), "actual extension request is reachable");
    await browser.executeJavaScript("[...document.querySelectorAll('.extension-ui-actions button')].find(button=>button.textContent==='Yes').click()");
    await waitFor(() => desktop.registry.sessionView(session)?.pendingExtensionUi.length === 0, "response reaches its original Runtime");
    assert.equal(await browser.executeJavaScript("document.querySelector('.cm-content').textContent"), "Unsent Project A draft");
    await browser.executeJavaScript("window.__navigationEditor=document.querySelector('.cm-editor');document.querySelector('[aria-label=\"Show the Projects sidebar\"]').click()");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.hidden==='false'"), "sidebar restores");
    desktop.window.showInactive();
    await frames();
    const handle = await browser.executeJavaScript("(()=>{const r=document.querySelector('.resize-handle').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+50)};})()") as { x: number; y: number };
    browser.sendInputEvent({ type: "mouseDown", ...handle, button: "left", clickCount: 1 });
    browser.sendInputEvent({ type: "mouseMove", x: handle.x + 40, y: handle.y, movementX: 40, movementY: 0 });
    browser.sendInputEvent({ type: "mouseUp", x: handle.x + 40, y: handle.y, button: "left", clickCount: 1 });
    await waitFor(() => desktop.navigation.view.sidebar.width === 292, "pointer drag commits the sidebar width once at completion");
    assert.equal(await browser.executeJavaScript("window.__navigationRoot===document.querySelector('.frostpi-root') && window.__navigationEditor===document.querySelector('.cm-editor') && document.querySelector('.cm-content').textContent==='Unsent Project A draft'"), true);
    await writeFile(join(directory, "desktop-project-navigation.png"), (await browser.capturePage()).toPNG());

    desktop.window.setSize(280, 700);
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.narrow==='true'"), "280px uses a drawer rather than shrinking the client");
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Expand composer\"]').click();document.querySelector('[aria-label=\"Open the Projects drawer\"]').click()");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.drawer==='open'"), "narrow Project drawer opens");
    await browser.executeJavaScript("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.drawer==='closed'"), "Escape closes only the drawer");
    assert.equal(await browser.executeJavaScript("Boolean(document.querySelector('.composer-expanded'))"), true);
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Minimize composer\"]').click();document.querySelector('[aria-label=\"Open the Projects drawer\"]').click()");
    await chooseProject(b!.cwd);
    await waitFor(() => desktop.projects.selected?.id === b!.id && desktop.registry.activeSessionId === null, "drawer selection shows the empty Project");
    assert.equal(await browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.drawer"), "closed");
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Open the Projects drawer\"]').click()");
    await chooseProject(a!.cwd);
    await waitFor(() => browser.executeJavaScript("document.querySelector('.cm-content')?.textContent==='Unsent Project A draft'"), "Project return retains its last Session draft");
    assert.equal(await browser.executeJavaScript("document.documentElement.scrollWidth<=document.documentElement.clientWidth"), true);
    await checkProjectBar();
    await desktop.registry.clearActiveSession();
    await waitFor(() => browser.executeJavaScript("Boolean(document.querySelector('.choose-trigger'))"), "unselected Project keeps its session chooser on the left");
    await browser.executeJavaScript("document.querySelector('.choose-trigger').click()");
    await frames();
    assert.equal(await browser.executeJavaScript(`(() => {
      const menu=document.querySelector('.choose-popover').getBoundingClientRect();
      const bar=document.querySelector('.project-bar').getBoundingClientRect();
      return menu.left>=bar.left&&menu.right<=bar.right&&menu.right<=innerWidth;
    })()`), true);
    await checkProjectBar();
    await browser.executeJavaScript("document.querySelector('.choose-item').click()");
    await waitFor(() => browser.executeJavaScript("document.querySelector('.cm-content')?.textContent==='Unsent Project A draft'"), "left-side session chooser restores the same draft");
    await frames();
    await writeFile(join(directory, "desktop-project-navigation-280.png"), (await browser.capturePage()).toPNG());
    desktop.window.setSize(1100, 800);
    await waitFor(() => browser.executeJavaScript("document.querySelector('.desktop-shell').dataset.narrow==='false'"), "wide navigation returns");
    await browser.executeJavaScript("document.querySelector('[aria-label=\"Hide the Projects sidebar\"]').click()");
    await waitFor(() => desktop.navigation.view.sidebar.hidden, "hidden preference is accepted");
    desktop.window.close();
    await waitFor(() => desktop.window.isDestroyed(), "navigation and Registry metadata drain on close");
    await desktop.dispose();
    const state = JSON.parse(await readFile(statePath, "utf8")) as { workspaceState: Record<string, { sessionProjects?: Record<string, string> }> };
    assert.equal(state.workspaceState["frostpi.desktop.navigation.v1"]?.sessionProjects?.[session], a!.id);
  } finally {
    await desktop.dispose();
    if (!desktop.window.isDestroyed()) desktop.window.destroy();
  }

  const reopened = await createDesktopApp({
    settingsStore: await DesktopSettingsStore.open(settingsPath),
    stateStore: await DesktopStateStore.open(statePath), discoverWorkingDirectories, show: false,
  });
  try {
    await waitFor(() => reopened.registry.sessionView(session)?.historyStatus === "loaded", "worktree-backed Session restores through the shared Runtime");
    await waitFor(() => reopened.window.webContents.executeJavaScript("document.querySelector('.desktop-shell')?.dataset.hidden==='true' && document.querySelector('.desktop-shell').style.getPropertyValue('--sidebar-width')==='292px'"), "hidden layout and dragged width restore");
    assert.equal(reopened.projects.selected?.id, a!.id);
    assert.equal(reopened.registry.activeSessionId, session);
    assert.equal(reopened.navigation.view.sessionProjects[session], a!.id);
    assert.equal(reopened.registry.sessionView(session)?.cwd, b!.cwd);

    const renderer = reopened.window.webContents;
    await renderer.executeJavaScript("window.frostpiDesktop.setSidebar({hidden:false,width:292})");
    const removeProject = (name: string) => renderer.executeJavaScript(`document.querySelector('[aria-label="Remove Project ${name}"]').click()`);
    await waitFor(() => renderer.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Remove Project new-project\"]'))"), "Project removal buttons mount");
    await removeProject("new-project");
    await waitFor(() => reopened.projects.list().length === 2, "an empty Project is removed through the real button and IPC");
    assert.equal(reopened.registry.activeSessionId, session);
    await access(cRoot);

    await renderer.executeJavaScript(`window.frostpiDesktop.selectProject(${JSON.stringify(b!.id)})`);
    await waitFor(() => renderer.executeJavaScript("Boolean(document.querySelector('.onboarding-actions .primary'))"), "Project B is empty before its own New");
    await renderer.executeJavaScript("document.querySelector('.onboarding-actions .primary').click()");
    await waitFor(() => renderer.executeJavaScript("Boolean(document.querySelector('dialog .choices button'))"), "Project B New selects its working directory");
    await renderer.executeJavaScript(`[...document.querySelectorAll('dialog .choices button')].find(button=>button.textContent.includes(${JSON.stringify(bRoot)})).click()`);
    await waitFor(() => reopened.registry.snapshot().activeSession?.status === "ready", "Project B Pi starts");
    const bSession = reopened.registry.activeSessionId;
    await reopened.registry.sendPrompt(bSession, "Commit Project removal fixture", []);
    await waitFor(() => reopened.registry.sessionView(bSession)?.status === "ready", "Project B history commits");
    await waitFor(() => renderer.executeJavaScript("Boolean(document.querySelector('.prompt-editor .cm-content'))"), "Project B Composer mounts");
    await renderer.executeJavaScript("document.querySelector('.prompt-editor .cm-content').focus();window.__removalRoot=document.querySelector('.frostpi-root');window.__removalEditor=document.querySelector('.cm-editor')");
    await renderer.insertText("Keep Project B draft");
    await reopened.registry.sendPrompt(session, "navigation-needs-input", []);
    await waitFor(() => reopened.registry.sessionView(session)?.pendingExtensionUi.length === 1, "Project A has a background pending request before removal");
    const aHistory = reopened.registry.sessionView(session)!.sessionFile!;
    const bHistory = reopened.registry.sessionView(bSession)!.sessionFile!;
    const originalConfirmation = Object.getOwnPropertyDescriptor(dialog, "showMessageBox")!;
    let allowRemoval = false;
    let confirmations = 0;
    Object.defineProperty(dialog, "showMessageBox", {
      ...originalConfirmation,
      value: (_window: unknown, options: Electron.MessageBoxOptions) => {
        confirmations++;
        return Promise.resolve({ response: allowRemoval ? 0 : options.cancelId, checkboxChecked: false });
      },
    });
    try {
      await removeProject("repository");
      await waitFor(() => confirmations === 1, "removing an occupied Project asks for confirmation");
      assert.equal(reopened.projects.list().length, 2);
      assert.equal(reopened.registry.hasSession(session), true);
      assert.equal(reopened.registry.activeSessionId, bSession);
      allowRemoval = true;
      await removeProject("repository");
      await waitFor(() => reopened.projects.list().length === 1 && !reopened.registry.hasSession(session), "Project A and its owned worktree Session close without removing Project B");
      assert.equal(reopened.registry.activeSessionId, bSession);
      await waitFor(() => renderer.executeJavaScript("document.querySelectorAll('.project-select').length===1"), "removed Project disappears from the sidebar");
      assert.equal(await renderer.executeJavaScript("window.__removalRoot===document.querySelector('.frostpi-root')&&window.__removalEditor===document.querySelector('.cm-editor')&&document.querySelector('.cm-content').textContent==='Keep Project B draft'"), true);
      await removeProject("linked-worktree");
      await waitFor(() => reopened.projects.list().length === 0 && reopened.registry.snapshot().sessions.length === 0, "removing the foreground Project closes its own Session");
      assert.equal(reopened.projects.selected, null);
      assert.equal(reopened.registry.activeSessionId, null);
      await waitFor(() => renderer.executeJavaScript("Boolean(document.querySelector('.empty-projects'))&&!document.querySelector('.cm-content')"), "the last Project leaves an empty application without remounting ClientApp");
      assert.equal(await renderer.executeJavaScript("window.__removalRoot===document.querySelector('.frostpi-root')"), true);
      await Promise.all([aRoot, bRoot, aHistory, bHistory].map((path) => access(path)));
    } finally {
      Object.defineProperty(dialog, "showMessageBox", originalConfirmation);
    }
  } finally {
    await reopened.dispose();
    if (!reopened.window.isDestroyed()) reopened.window.destroy();
  }

  const empty = await createDesktopApp({
    settingsStore: await DesktopSettingsStore.open(settingsPath),
    stateStore: await DesktopStateStore.open(statePath), show: false,
  });
  try {
    assert.deepEqual(empty.projects.list(), []);
    assert.equal(empty.projects.selected, null);
    assert.equal(empty.registry.snapshot().sessions.length, 0);
  } finally {
    await empty.dispose();
    if (!empty.window.isDestroyed()) empty.window.destroy();
  }
}
