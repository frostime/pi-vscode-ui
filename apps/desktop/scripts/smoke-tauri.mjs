import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { devtoolsClient, openDebuggingSocket } from "./cdp-client.mjs";
import { runPowerShell } from "./powershell.mjs";

const executable = resolve(process.argv[2] ?? "src-tauri/target/debug/frostpi-desktop.exe");
assert.ok(existsSync(executable), "Build the Tauri executable first");
const directory = mkdtempSync(join(tmpdir(), "frostpi-tauri-smoke-"));
const profile = join(directory, "profile"); const project = join(directory, "project");
for (const path of [profile, project, join(directory, "pi-agent")]) mkdirSync(path);
const fixturePi = join(directory, "fixture-pi.cjs");
cpSync(resolve("../pi-client/test/fixtures/fake-pi.cjs"), fixturePi);
const settings = { "frostpi.pi.executable": fixturePi, "frostpi.session.startOnOpen": true, "frostpi.pi.arguments": ["--persist-session-fixture"], "desktop.theme": "dark" };
writeFileSync(join(profile, "settings.json"), JSON.stringify(settings));
const checks = [];
let child; let client;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error(`Tauri smoke timed out: ${label}`);
}
const rows = "[...document.querySelectorAll('.project-row button.project-select')]";
async function launch(directories = []) {
  const server = createServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve));
  child = spawn(executable, directories, { cwd: directory, windowsHide: true, stdio: "ignore", env: {
    ...process.env, FROSTPI_DESKTOP_USER_DATA: profile, PI_CODING_AGENT_DIR: join(directory, "pi-agent"),
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
async function closeWindow() {
  runPowerShell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FrostPiSmokeWindow { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; $p = Get-Process -Id ${child.pid}; if ($p.MainWindowHandle -eq [IntPtr]::Zero) { throw "No visible main window" }; if (-not [FrostPiSmokeWindow]::PostMessage($p.MainWindowHandle, 16, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "WM_CLOSE failed" }`, { capture: true, timeout: 10000 });
  await until(() => child.exitCode !== null, "normal close drains backend");
  assert.equal(child.exitCode, 0);
  client.close(); client = undefined;
}
async function send(text) {
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-content[aria-label=\"Message Pi\"]'))"), "composer mounts before typing");
  await client.typeIntoComposer(text);
  await until(() => client.evaluate("Boolean(document.querySelector('[aria-label=\"Send to Pi\"]')) && !document.querySelector('[aria-label=\"Send to Pi\"]').disabled"), "composer can send");
  await client.evaluate("document.querySelector('[aria-label=\"Send to Pi\"]').click()");
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
  await launch([project]);
  assert.equal(await client.evaluate("document.title"), "FrostPi Desktop");
  assert.equal(await client.evaluate("typeof window.require"), "undefined");
  assert.equal(await client.evaluate("typeof window.process"), "undefined");
  await until(() => client.evaluate(`${rows}.length === 1`), "startup Project");
  checks.push("actual WebView2 mounts shared client and isolated finite bridge");
  const read = await client.evaluate("window.frostpiDesktop.settings({type:'read'})");
  assert.equal(read.values["desktop.theme"], "dark");
  assert.equal(await client.evaluate("window.frostpiDesktop.settings({type:'arbitraryFileRead',path:'invalid'}).then(()=>false,()=>true)"), true);
  checks.push("settings read and invalid-operation rejection");
  await client.evaluate("document.querySelector('.onboarding-actions .primary')?.click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.cm-content[aria-label=\"Message Pi\"]'))"), "composer ready");
  await send("tauri-smoke-prompt");
  await until(() => client.evaluate("document.querySelector('.conversation')?.textContent.includes('tauri-smoke-prompt') || document.querySelector('.conversation-frame')?.textContent.includes('tauri-smoke-prompt')"), "conversation round trip");
  await until(() => client.evaluate("document.querySelector('.conversation-frame')?.textContent.includes('E2E response') && !document.querySelector('[aria-label=\"Stop Pi\"]')"), "assistant response completes");
  checks.push("controlled Pi prompt crosses Rust/Node/shared UI");
  await send("mermaid");
  await until(() => client.evaluate("Boolean(document.querySelector('.mermaid-host svg'))"), "Mermaid vendor loads");
  checks.push("Mermaid bundled assets render in WebView2");
  await verifyOversizedPrompt();
  const initialWidth = await client.evaluate("innerWidth");
  await client.evaluate("window.frostpiDesktop.settings({type:'read'}).then(view => window.frostpiDesktop.settings({type:'save',values:{...view.values,'desktop.theme':'light','desktop.zoomFactor':1.2}}))");
  await until(() => client.evaluate("document.body.classList.contains('vscode-light')"), "live theme");
  await until(() => client.evaluate(`innerWidth < ${initialWidth} * 0.9`), "native WebView2 zoom scales viewport");
  checks.push("live settings/theme and measured native zoom");
  await closeWindow();
  const state = JSON.parse(readFileSync(join(profile, "state.json"), "utf8"));
  assert.equal(state.projects.length, 1);
  assert.ok(state.workspaceState["frostpi.sessions.v1"].sessions.length > 0);
  checks.push("normal native close flushes Project/session state");
  await launch();
  await until(() => client.evaluate(`${rows}.length === 1`), "restored Project");
  assert.equal((await client.evaluate("window.frostpiDesktop.settings({type:'read'})")).values["desktop.theme"], "light");
  checks.push("native reopen restores Projects/settings");
  await closeWindow();
  await launch();
  await send("tauri-crash-prompt");
  await until(() => client.evaluate("document.querySelector('.conversation-frame')?.textContent.includes('tauri-crash-prompt')"), "Pi active before crash");
  const ownedNodes = JSON.parse(runPowerShell(`$all = @(Get-CimInstance Win32_Process); $todo = @(${child.pid}); $ids = @(); while($todo.Count -gt 0) { $next = @(); foreach($parent in $todo) { foreach($p in $all) { if($p.ParentProcessId -eq $parent) { $next += $p.ProcessId; if($p.Name -eq 'node.exe') { $ids += $p.ProcessId } } } }; $todo = $next }; ConvertTo-Json -InputObject @($ids) -Compress`, {capture:true,timeout:10000}));
  assert.ok(ownedNodes.length >= 2, "Expected a Node backend and a controlled Pi child");
  child.kill();
  client.close(); client = undefined;
  await until(() => ownedNodes.every((pid) => { try { process.kill(pid, 0); return false; } catch { return true; } }), "Job Object removes Node and Pi on shell crash");
  checks.push("forced shell exit kills backend and Pi descendants");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ok: true, executable, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, directory, checks }));
} catch (error) {
  let startup;
  try { startup = await client?.evaluate("({url:location.href,api:typeof window.frostpiDesktop,tauri:typeof window.__TAURI_INTERNALS__,shell:!!document.querySelector('.desktop-shell'),connectionError:document.getElementById('app')?.textContent.startsWith('FrostPi could not connect'),scripts:[...document.scripts].map(s=>s.src)})"); } catch { /* The child may already be gone. */ }
  if (startup?.connectionError) {
    try { startup.rpcError = await client.evaluate("Promise.race([window.__TAURI_INTERNALS__.invoke('desktop_connect',{channel:'__CHANNEL__:'+window.__TAURI_INTERNALS__.transformCallback(()=>{})}).then(()=>null,error=>String(error).slice(0,256)),new Promise(resolve=>setTimeout(()=>resolve('Connection retry still pending'),3000))])"); } catch { /* Diagnostic only. */ }
  }
  writeFileSync(join(directory, "result.json"), JSON.stringify({ ok: false, error: String(error), checks, startup }, null, 2));
  if (startup) console.error(JSON.stringify(startup));
  console.error(String(error)); console.error(`Tauri smoke artifacts: ${directory}`); process.exitCode = 1;
} finally {
  client?.close(); if (child && child.exitCode === null) child.kill();
}
