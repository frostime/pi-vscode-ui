import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { devtoolsClient, openDebuggingSocket } from "./cdp-client.mjs";
import { powerShellLiteral, runPowerShell } from "./powershell.mjs";

const executable = resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "src-tauri/target/release/frostpi-desktop.exe");
assert.ok(existsSync(executable), "Build the Tauri executable first");
const directory = mkdtempSync(join(tmpdir(), "frostpi-tauri-smoke-"));
let profile = join(directory, "profile"); const project = join(directory, "project");
const secondProject = join(directory, "second-project"); const sessionsRoot = join(directory, "sessions");
for (const path of [profile, project, secondProject, sessionsRoot, join(directory, "pi-agent")]) mkdirSync(path);
const fixturePi = join(directory, "fixture-pi.cjs");
cpSync(resolve("../pi-client/test/fixtures/fake-pi.cjs"), fixturePi);
const settings = { "frostpi.pi.executable": fixturePi, "frostpi.session.startOnOpen": true, "frostpi.pi.arguments": ["--persist-session-fixture", "--session-dir", sessionsRoot, "--stream-084-release", join(directory, "release-stream")], "desktop.theme": "dark" };
writeFileSync(join(profile, "settings.json"), JSON.stringify(settings));
const checks = [];
const manualChecks = ["tray right-click Exit and confirmation, including after reopening"];
let child; let client; let trayNoticeSeen = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error(`Tauri smoke timed out: ${label}`);
}
const rows = "[...document.querySelectorAll('.project-row button.project-select')]";
async function launch(directories = [], extraEnvironment = {}) {
  trayNoticeSeen = false;
  const server = createServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve));
  child = spawn(executable, directories, { cwd: directory, windowsHide: true, stdio: "ignore", env: {
    ...process.env, ...extraEnvironment, FROSTPI_DESKTOP_USER_DATA: profile, PI_CODING_AGENT_DIR: join(directory, "pi-agent"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  } });
  child.once("error", () => {});
  let page;
  await until(async () => {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json(); page = list.find((p) => p.type === "page" && /tauri\.localhost|tauri:\/\/localhost/.test(p.url)); return !!page; } catch { return false; }
  }, "WebView2 endpoint");
  client = devtoolsClient(await openDebuggingSocket(page.webSocketDebuggerUrl));
  await until(() => client.evaluate("Boolean(window.frostpiDesktop && document.querySelector('.desktop-shell'))"), "shared client mounts");
}
function nativeWindow(action) {
  const output = runPowerShell(`& ${powerShellLiteral(resolve("scripts/native-window.ps1"))} -OwnerProcessId ${child.pid} -Action ${powerShellLiteral(action)}`, { capture: true, timeout: 15000 });
  return action === "state" ? JSON.parse(output) : undefined;
}
async function hideWindow() {
  nativeWindow("close");
  if (!trayNoticeSeen) { nativeDialog("accept", "", 1); trayNoticeSeen = true; }
  await until(() => !nativeWindow("state").visible, "X hides the window to its tray");
  assert.equal(child.exitCode, null);
}
async function closeAfterRendererFailure() {
  // Exercise the existing failure/disposal path without depending on Windows tray menus.
  // Tray Exit and its confirmation are accepted manually, not claimed by this runner.
  void client.command("Page.crash").catch(() => undefined);
  await until(() => child.exitCode !== null, "renderer failure drains backend and closes the native host");
  assert.equal(child.exitCode, 0);
  client.close(); client = undefined;
}
async function send(text) {
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-content[aria-label=\"Message Pi\"]'))"), "composer mounts before typing");
  await client.typeIntoComposer(text);
  // Startup can disable Send between separate CDP calls. Check and click in the same renderer task.
  await until(() => client.evaluate("(() => { const button = document.querySelector('[aria-label=\"Send to Pi\"]'); if (!button || button.disabled) return false; button.click(); return true; })()"), "composer can send");
}
function nativeDialog(action, value = "", taskButtonId = 0) {
  runPowerShell(`& ${powerShellLiteral(resolve("scripts/native-dialog.ps1"))} -OwnerProcessId ${child.pid} -Action ${powerShellLiteral(action)} -Value ${powerShellLiteral(value)} -TaskButtonId ${taskButtonId}`, { capture: true, timeout: 20000 });
}
async function observeProjects() {
  await client.evaluate("window.__projectsUnsubscribe?.();window.__projectsUnsubscribe=window.frostpiDesktop.onProjects(view=>window.__projects=view);window.frostpiDesktop.requestProjects()");
  await until(() => client.evaluate("Boolean(window.__projects)"), "Project subscription");
}
async function selectProject(index) {
  await client.evaluate(`${rows}[${index}].click()`);
  await until(() => client.evaluate(`${rows}[${index}].getAttribute('aria-current')==='true'`), "Project selection");
}
async function newSession() {
  await until(() => client.evaluate("Boolean(document.querySelector('.onboarding-actions .primary'))"), "empty Project New entry");
  await client.evaluate("document.querySelector('.onboarding-actions .primary').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-content'))"), "New session editor");
}
async function resumePicker() {
  await client.evaluate("document.querySelector('[aria-label=\"New or resume session\"]').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.session-launcher-menu'))"), "session launcher");
  await client.evaluate("[...document.querySelectorAll('.session-launcher-menu button')].find(b=>b.textContent.includes('Resume')).click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.resume-choice'))"), "Resume choices");
}
async function verifyTrayBehavior() {
  assert.equal(nativeWindow("state").tray, true);
  await send("stream-084");
  await until(() => client.evaluate("Boolean(document.querySelector('[aria-label=\"Stop Pi\"]'))"), "task active before hide");
  await client.typeIntoComposer("tray-unsent-draft");
  await client.evaluate("window.__trayRoot=document.querySelector('.frostpi-root');window.__trayEditor=document.querySelector('.cm-editor')");
  await hideWindow();
  const sessionFile = join(project, readdirSync(project).find(name => name.endsWith(".jsonl")));
  const release = join(directory, "release-stream");
  const completedBefore = readFileSync(sessionFile, "utf8").split('"file body"').length;
  writeFileSync(release, "finish");
  await until(() => readFileSync(sessionFile, "utf8").split('"file body"').length > completedBefore, "Pi finishes and persists its result while the window is hidden");
  unlinkSync(release);
  nativeWindow("restore");
  await until(() => nativeWindow("state").visible && client.evaluate("!document.querySelector('[aria-label=\"Stop Pi\"]')"), "tray click restores the completed task");
  assert.equal(await client.evaluate("window.__trayRoot===document.querySelector('.frostpi-root') && window.__trayEditor===document.querySelector('.cm-editor') && document.querySelector('.cm-content').textContent==='tray-unsent-draft'"), true);
  checks.push("X hides without stopping Pi; tray click restores the same client and draft after background completion");
  await client.evaluate("document.querySelector('[aria-label=\"Send to Pi\"]').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-placeholder')) && !document.querySelector('[aria-label=\"Stop Pi\"]')"), "retained draft sends normally after restore");
}
async function verifyParallelAndResume() {
  await observeProjects();
  await client.evaluate("window.__clientRoot=document.querySelector('.frostpi-root')");
  await send("stream-084");
  await until(() => client.evaluate("Boolean(document.querySelector('[aria-label=\"Stop Pi\"]'))"), "Project A streaming");
  await selectProject(1); await newSession(); await send("stream-084");
  await until(() => client.evaluate("Object.values(window.__projects.navigation.activity).filter(a=>a.running===1).length===2"), "two Projects stream concurrently");
  await client.evaluate("document.querySelector('[aria-label=\"Stop Pi\"]').click()");
  await until(() => client.evaluate("!document.querySelector('[aria-label=\"Stop Pi\"]') && Object.values(window.__projects.navigation.activity).filter(a=>a.running===1).length===1"), "Stop B leaves A running");
  await selectProject(0);
  await until(() => client.evaluate("Boolean(document.querySelector('[aria-label=\"Stop Pi\"]'))"), "switching back retains A turn");
  await client.evaluate("document.querySelector('[aria-label=\"Stop Pi\"]').click()");
  await until(() => client.evaluate("!document.querySelector('[aria-label=\"Stop Pi\"]') && Object.values(window.__projects.navigation.activity).every(a=>a.running===0)"), "Stop A settles both");
  assert.equal(await client.evaluate("window.__clientRoot===document.querySelector('.frostpi-root')"), true);
  checks.push("two Projects run concurrently; Stop and selection preserve session ownership");
  // The shared fixture writes into cwd; seed the configured catalog directory
  // with its actual persisted JSONL, as an installed Pi would store it there.
  for (const [index, root] of [project, secondProject].entries()) {
    const file = readdirSync(root).find(name => name.endsWith(".jsonl"));
    assert.ok(file); cpSync(join(root, file), join(sessionsRoot, `saved-${index}.jsonl`));
  }
  await client.typeIntoComposer("保留草稿");
  await client.evaluate("window.__resumeEditor=document.querySelector('.cm-editor')");
  await resumePicker();
  await client.evaluate("document.querySelector('.resume-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await until(() => client.evaluate("!document.querySelector('.resume-overlay')"), "Resume cancellation");
  assert.equal(await client.evaluate("window.__resumeEditor===document.querySelector('.cm-editor') && document.querySelector('.cm-content').textContent==='保留草稿'"), true);
  if (process.argv.includes("--native-dialogs")) {
    await resumePicker();
    await client.evaluate("[...document.querySelectorAll('.resume-choice')].find(b=>b.textContent.includes('Browse')).click()"); nativeDialog("cancel");
    await until(() => client.evaluate("!document.querySelector('.resume-overlay')"), "native session-file cancel");
    await resumePicker();
    await client.evaluate("[...document.querySelectorAll('.resume-choice')].find(b=>b.textContent.includes('Browse')).click()");
    nativeDialog("path", join(project, readdirSync(project).find(name => name.endsWith(".jsonl"))));
    await until(() => client.evaluate("!document.querySelector('.resume-overlay')"), "native session-file selection");
    checks.push("native session-file dialog cancels and resumes a saved JSONL file");
  }
  await resumePicker();
  await selectProject(1);
  await until(() => client.evaluate("Boolean(document.querySelector('.resume-return')) && !document.querySelector('.resume-overlay')"), "Resume hides while switching Projects");
  await client.evaluate("document.querySelector('.resume-return').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.resume-choice'))"), "Resume returns to its owning Project");
  await client.evaluate("[...document.querySelectorAll('.resume-choice')].find(b=>!b.textContent.includes('Browse')).click()");
  await until(() => client.evaluate("!document.querySelector('.resume-overlay') && document.querySelector('.conversation-frame').textContent.includes('desktop-limit-draft')"), "Resume loads saved history");
  checks.push("Resume cancellation preserves editor/draft; Project switch and saved-history loading work");
}
async function verifySettingsAndComposition() {
  await client.evaluate("document.querySelector('.settings-button').click()");
  await until(() => client.evaluate("Boolean(document.getElementById('setting-chat.fontSize'))"), "settings panel");
  await client.evaluate("document.querySelector('[aria-label=\"Details for Conversation text size\"]').click()");
  if (process.argv.includes("--native-dialogs")) {
    const ready = join(directory, "clipboard-ready"); const result = join(directory, "clipboard-result");
    const probe = spawn("powershell", ["-NoProfile", "-NonInteractive", "-STA", "-File", resolve("scripts/clipboard-probe.ps1"), "-ReadyPath", ready, "-ResultPath", result, "-Expected", "chat.fontSize"], { windowsHide: true, stdio: "ignore" });
    try {
      await until(() => { if (probe.exitCode !== null) throw new Error("Windows clipboard snapshot is unavailable in this desktop session"); return existsSync(ready); }, "clipboard probe preserves original data");
      await client.evaluate("document.querySelector('.copy-key').click()");
      await until(() => probe.exitCode !== null, "native clipboard round trip and restoration");
      assert.equal(probe.exitCode, 0); assert.equal(readFileSync(result, "utf8"), "ok");
    } finally { if (probe.exitCode === null) probe.kill(); }
    checks.push("native clipboard round trip restores original formats");
  }
  await client.evaluate("(()=>{const f=document.getElementById('setting-chat.fontSize');f.value='17';f.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('dialog header button').click()})()");
  await until(() => client.evaluate("Boolean(document.querySelector('.discard-dialog'))"), "unsaved settings close guard");
  await client.evaluate("document.querySelector('.discard-dialog button').click()");
  assert.equal(await client.evaluate("document.getElementById('setting-chat.fontSize').value"), "17");
  await client.evaluate("document.querySelector('dialog .save').click()");
  await until(() => client.evaluate("document.querySelector('dialog .save').disabled && document.querySelector('.save-status').textContent.includes('No unsaved')"), "settings UI saves");
  assert.equal((await client.evaluate("window.frostpiDesktop.settings({type:'read'})")).values["chat.fontSize"], 17);
  await client.evaluate("document.querySelector('dialog header button').click()");
  await until(() => client.evaluate("!document.querySelector('#settings-title')"), "settings close");
  // Chromium composition delivery to the actual CodeMirror; no claim about every Windows IME.
  await client.evaluate("document.querySelector('.cm-content').focus()");
  await client.command("Input.imeSetComposition", { text: "中文输入", selectionStart: 4, selectionEnd: 4 });
  await client.command("Input.insertText", { text: "中文输入" });
  assert.equal(await client.evaluate("document.querySelector('.cm-content').textContent.endsWith('中文输入')"), true);
  await client.evaluate("window.__zoomEditor=document.querySelector('.cm-editor');window.__zoomDraft=document.querySelector('.cm-content').textContent");
  const before = await client.evaluate("innerWidth");
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "+", code: "Equal", windowsVirtualKeyCode: 187 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "+", code: "Equal", windowsVirtualKeyCode: 187 });
  await until(() => client.evaluate(`innerWidth < ${before}`), "Ctrl+plus native zoom shortcut");
  assert.equal(await client.evaluate("window.__zoomEditor===document.querySelector('.cm-editor') && window.__zoomDraft===document.querySelector('.cm-content').textContent"), true);
  checks.push("settings draft/save, Chinese composition and zoom preserve editor");
}
async function verifyNativeDialogs() {
  // Exercise real rfd dialogs in this owned process; no product test commands or native mocks.
  await client.evaluate("window.frostpiDesktop.addProject()"); nativeDialog("cancel");
  await until(() => client.evaluate(`${rows}.length===2`), "cancel Add Project");
  const added = join(directory, "added-project"); mkdirSync(added);
  await client.evaluate("window.frostpiDesktop.addProject()"); nativeDialog("path", added);
  await until(() => client.evaluate(`${rows}.length===3`), "native folder picker adds Project");
  await selectProject(0);
  await client.evaluate("document.querySelector('[aria-label=\"Remove Project project\"]').click()"); nativeDialog("cancel");
  assert.equal(await client.evaluate(`${rows}.length`), 3);
  await selectProject(1);
  await client.typeIntoComposer("keep-background-project-draft");
  await client.evaluate("window.__removeEditor=document.querySelector('.cm-editor');document.querySelector('[aria-label=\"Remove Project project\"]').click()"); nativeDialog("accept");
  await until(() => client.evaluate(`${rows}.length===2`), "native confirmation removes only its Project");
  assert.equal(await client.evaluate("window.__removeEditor===document.querySelector('.cm-editor') && document.querySelector('.cm-content').textContent==='keep-background-project-draft'"), true);
  assert.equal(existsSync(project), true);
  checks.push("native folder dialog cancel/select and Project removal cancel/confirm preserve other Project draft and files");
}
async function verifyInstalledPi() {
  profile = join(directory, "installed-pi-profile"); mkdirSync(profile);
  const extension = join(directory, "offline-command.mjs");
  writeFileSync(extension, `export default function(pi) {
    pi.registerCommand("package-check", {description:"Isolated offline verification", handler:async (_args,ctx)=>{
      const ok=await ctx.ui.confirm("Package verification","Confirm isolated SDK verification",{timeout:10000});
      pi.sendMessage({customType:"package-check",content:ok?"FROSTPI_REAL_RPC_OK":"FROSTPI_REAL_RPC_CANCELLED",display:true});
    }});
  }`);
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ "frostpi.pi.arguments": ["--model", "openai/gpt-4o", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "-e", extension] }));
  await launch([project], { PI_OFFLINE: "1" });
  await newSession();
  await until(() => client.evaluate("document.querySelector('.session-heading .status-dot')?.getAttribute('aria-label')==='ready'"), "installed Pi starts");
  let temporary = false;
  for (let attempt = 0; attempt < 10 && !temporary; attempt++) {
    await client.evaluate("document.querySelector('[aria-label=\"New or resume session\"]').click()");
    await until(() => client.evaluate("Boolean(document.querySelector('.launcher-expand'))"), "temporary session launcher");
    await client.evaluate("document.querySelector('.launcher-expand').click()");
    await client.evaluate("[...document.querySelectorAll('.launcher-variants button')].find(b=>b.textContent.includes('New temporary session')).click()");
    temporary = await until(() => client.evaluate("Boolean(document.querySelector('.ephemeral-badge'))"), "temporary installed-Pi session", 1500).then(() => true, () => false);
    if (!temporary) await delay(200);
  }
  assert.equal(temporary, true, "installed Pi temporary session");
  await send("/package-check");
  await until(() => client.evaluate("document.querySelector('section.extension-ui-card')?.textContent.includes('Confirm isolated SDK verification')"), "installed Pi command requests confirmation");
  await client.evaluate("document.querySelector('.extension-ui-actions .primary').click()");
  await until(() => client.evaluate("[...document.querySelectorAll('.custom-message-trigger')].some(b=>b.textContent.includes('package-check'))"), "installed Pi custom message");
  await client.evaluate("[...document.querySelectorAll('.custom-message-trigger')].find(b=>b.textContent.includes('package-check')).click()");
  await until(() => client.evaluate("document.querySelector('.custom-message-content')?.textContent.includes('FROSTPI_REAL_RPC_OK')"), "installed Pi command result renders");
  await closeAfterRendererFailure();
  assert.deepEqual(JSON.parse(readFileSync(join(profile,"state.json"),"utf8")).workspaceState["frostpi.sessions.v1"].sessions, []);
  checks.push("installed Pi from desktop PATH: offline command, confirmation and ephemeral message; no model request");
}
async function verifyOversizedPrompt() {
  await client.typeIntoComposer("desktop-limit-draft");
  await client.evaluate(`(() => {
    window.__limitEditor = document.querySelector('.cm-content');
    const data = new Uint8Array(9 * 1024 * 1024);
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLxLwAAAABJRU5ErkJggg==');
    data.set(Uint8Array.from(png, c => c.charCodeAt(0)));
    const clipboard = new DataTransfer();
    for(let i=0;i<3;i++) clipboard.items.add(new File([data], 'limit-'+i+'.png', {type:'image/png'}));
    window.__limitEditor.dispatchEvent(new ClipboardEvent('paste', {clipboardData:clipboard,bubbles:true,cancelable:true}));
  })()`);
  await until(() => client.evaluate("document.querySelectorAll('.attachment-item').length===3"), "three individually valid images reach the draft");
  await client.evaluate(`window.__limitFailures=0;window.__limitSubscription=window.frostpiDesktop.onClientMessage(message=>{if(message.type==='promptResult'&&!message.ok&&message.error?.includes('32 MiB'))window.__limitFailures++});document.querySelector('[aria-label="Send to Pi"]').click()`);
  await until(() => client.evaluate("window.__limitFailures===1 && document.querySelectorAll('.attachment-item').length===3 && document.querySelector('.cm-content').textContent==='desktop-limit-draft' && !document.querySelector('[aria-label=\"Send to Pi\"]').disabled"), "oversized prompt restores text/images and releases pending Send");
  assert.equal(await client.evaluate("window.__limitEditor===document.querySelector('.cm-content') && !document.querySelector('.transport-limit')"), true);
  assert.equal(await client.evaluate("document.querySelector('.conversation-frame').textContent.includes('desktop-limit-draft')"), false);
  assert.equal((await client.evaluate("window.frostpiDesktop.settings({type:'read'})")).values["desktop.theme"], "dark");
  await client.evaluate("[...document.querySelectorAll('.attachment-item button')].forEach(button=>button.click())");
  await until(() => client.evaluate("!document.querySelector('.attachment-item')"), "user removes oversized attachments");
  await client.evaluate("document.querySelector('[aria-label=\"Send to Pi\"]').click()");
  await until(() => client.evaluate("document.querySelector('.conversation-frame').textContent.includes('desktop-limit-draft') && !document.querySelector('[aria-label=\"Stop Pi\"]')"), "the retained draft sends normally after reducing attachments");
  await client.evaluate("window.__limitSubscription()");
  checks.push("32 MiB rejection preserves draft and backend; smaller resend succeeds");
}

try {
  await launch([project, secondProject]);
  assert.equal(await client.evaluate("document.title"), "FrostPi Desktop");
  assert.equal(await client.evaluate("typeof window.require"), "undefined");
  assert.equal(await client.evaluate("typeof window.process"), "undefined");
  await until(() => client.evaluate(`${rows}.length === 2`), "startup Project");
  checks.push("actual WebView2 mounts shared client and isolated finite bridge");
  const read = await client.evaluate("window.frostpiDesktop.settings({type:'read'})");
  assert.equal(read.values["desktop.theme"], "dark");
  assert.equal(await client.evaluate("window.frostpiDesktop.settings({type:'arbitraryFileRead',path:'invalid'}).then(()=>false,()=>true)"), true);
  checks.push("settings read and invalid-operation rejection");
  await client.evaluate("document.querySelector('.onboarding-actions .primary')?.click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-content[aria-label=\"Message Pi\"]'))"), "composer ready");
  await send("desktop-smoke-prompt");
  await until(() => client.evaluate("document.querySelector('.conversation')?.textContent.includes('desktop-smoke-prompt') || document.querySelector('.conversation-frame')?.textContent.includes('desktop-smoke-prompt')"), "conversation round trip");
  await until(() => client.evaluate("document.querySelector('.conversation-frame')?.textContent.includes('E2E response') && !document.querySelector('[aria-label=\"Stop Pi\"]')"), "assistant response completes");
  checks.push("controlled Pi prompt crosses Rust/Node/shared UI");
  await send("mermaid");
  await until(() => client.evaluate("Boolean(document.querySelector('.mermaid-host svg'))"), "Mermaid vendor loads");
  checks.push("Mermaid bundled assets render in WebView2");
  await verifyTrayBehavior();
  await verifyOversizedPrompt();
  await verifyParallelAndResume();
  if (process.argv.includes("--native-dialogs")) await verifyNativeDialogs();
  await verifySettingsAndComposition();
  const initialWidth = await client.evaluate("innerWidth");
  const initialZoom = (await client.evaluate("window.frostpiDesktop.settings({type:'read'})")).values["desktop.zoomFactor"] ?? 1;
  await client.evaluate("window.frostpiDesktop.settings({type:'read'}).then(view => window.frostpiDesktop.settings({type:'save',values:{...view.values,'desktop.theme':'light','desktop.zoomFactor':1.2}}))");
  await until(() => client.evaluate("document.body.classList.contains('vscode-light')"), "live theme");
  await until(() => client.evaluate(`Math.abs(innerWidth * 1.2 - ${initialWidth * initialZoom}) <= 2`), "native WebView2 zoom scales viewport");
  checks.push("live settings/theme and measured native zoom");
  await client.evaluate("document.querySelector('[aria-label=\"Send to Pi\"]').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-placeholder')) && !document.querySelector('[aria-label=\"Stop Pi\"]')"), "composed draft sends before renderer failure");
  await send("stream-084");
  await until(() => client.evaluate("Boolean(document.querySelector('[aria-label=\"Stop Pi\"]'))"), "active task before renderer failure");
  await hideWindow();
  await closeAfterRendererFailure();
  const state = JSON.parse(readFileSync(join(profile, "state.json"), "utf8"));
  assert.equal(state.projects.length, 2);
  assert.ok(state.workspaceState["frostpi.sessions.v1"].sessions.length > 0);
  checks.push("renderer failure stops active Pi and flushes Project/session state");
  await launch();
  await until(() => client.evaluate(`${rows}.length === 2`), "restored Project");
  assert.equal((await client.evaluate("window.frostpiDesktop.settings({type:'read'})")).values["desktop.theme"], "light");
  checks.push("native reopen restores Projects/settings");
  await closeAfterRendererFailure();
  checks.push("renderer failure also disposes the reopened idle backend");
  await launch();
  await send("stream-084");
  await until(() => client.evaluate("document.querySelector('.conversation-frame')?.textContent.includes('stream-084')"), "Pi active before crash");
  const ownedNodes = JSON.parse(runPowerShell(`$all = @(Get-CimInstance Win32_Process); $todo = @(${child.pid}); $ids = @(); while($todo.Count -gt 0) { $next = @(); foreach($parent in $todo) { foreach($p in $all) { if($p.ParentProcessId -eq $parent) { $next += $p.ProcessId; if($p.Name -eq 'node.exe') { $ids += $p.ProcessId } } } }; $todo = $next }; ConvertTo-Json -InputObject @($ids) -Compress`, {capture:true,timeout:10000}));
  assert.ok(ownedNodes.length >= 2, "Expected a Node backend and a controlled Pi child");
  child.kill();
  client.close(); client = undefined;
  await until(() => ownedNodes.every((pid) => { try { process.kill(pid, 0); return false; } catch { return true; } }), "Job Object removes Node and Pi on shell crash");
  checks.push("forced shell exit kills backend and Pi descendants");
  if (process.argv.includes("--real-pi")) await verifyInstalledPi();
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ok: true, executable, checks, manualChecks }, null, 2));
  console.log(JSON.stringify({ ok: true, directory, checks, manualChecks }));
} catch (error) {
  let startup;
  try { startup = await client?.evaluate("({url:location.href,api:typeof window.frostpiDesktop,tauri:typeof window.__TAURI_INTERNALS__,shell:!!document.querySelector('.desktop-shell'),composerLength:document.querySelector('.cm-content')?.textContent.length,stopVisible:!!document.querySelector('[aria-label=\"Stop Pi\"]'),sendDisabled:document.querySelector('[aria-label=\"Send to Pi\"]')?.disabled,connectionError:document.getElementById('app')?.textContent.startsWith('FrostPi could not connect'),scripts:[...document.scripts].map(s=>s.src)})"); } catch { /* The child may already be gone. */ }
  if (startup?.connectionError) {
    try { startup.rpcError = await client.evaluate("Promise.race([window.__TAURI_INTERNALS__.invoke('desktop_connect',{channel:'__CHANNEL__:'+window.__TAURI_INTERNALS__.transformCallback(()=>{})}).then(()=>null,error=>String(error).slice(0,256)),new Promise(resolve=>setTimeout(()=>resolve('Connection retry still pending'),3000))])"); } catch { /* Diagnostic only. */ }
  }
  let nativeState;
  try { if (child?.exitCode === null) nativeState = nativeWindow("state"); } catch { /* The native host may already be exiting. */ }
  const failure = { ok: false, directory, error: String(error), checks, manualChecks, startup, nativeState };
  writeFileSync(join(directory, "result.json"), JSON.stringify(failure, null, 2));
  console.log(JSON.stringify(failure));
  if (startup || nativeState) console.error(JSON.stringify({ startup, nativeState }));
  console.error(String(error)); console.error(`Tauri smoke artifacts: ${directory}`); process.exitCode = 1;
} finally {
  client?.close(); if (child && child.exitCode === null) child.kill();
}
