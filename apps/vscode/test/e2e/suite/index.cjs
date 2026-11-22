const assert = require("node:assert/strict");
const path = require("node:path");
const { readFile, writeFile } = require("node:fs/promises");
const vscode = require("vscode");

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for extension condition");
}

async function run() {
  const fakePi = path.resolve(__dirname, "../../../../pi-client/test/fixtures/fake-pi.cjs");
  await vscode.workspace.getConfiguration("frostpi").update("pi.executable", fakePi, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration("frostpi").update("session.startOnOpen", true, vscode.ConfigurationTarget.Global);

  const extension = vscode.extensions.getExtension("frostime.frostpi");
  assert.ok(extension, "development extension is discoverable");
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  for (const command of ["frostpi.focus", "frostpi.newSession", "frostpi.stop", "frostpi.exportDiagnostics"]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }

  await vscode.commands.executeCommand("frostpi.newSession");
  await waitFor(async () => (await vscode.commands.getCommands(true)).includes("frostpi.stop"));
  await vscode.commands.executeCommand("frostpi.stop");
  await verifyCloseWithEditorTab(fakePi);
  if (process.env.FROSTPI_E2E_RESULT) {
    await writeFile(process.env.FROSTPI_E2E_RESULT, JSON.stringify({
      ok: true, suiteCompleted: true, vscodeVersion: vscode.version, controlledPi: true,
      commandsRegistered: true, newCommandCompleted: true, stopCommandCompleted: true, editorTabClosedSession: true,
    }));
  }
}

async function verifyCloseWithEditorTab(fakePi) {
  const config = vscode.workspace.getConfiguration("frostpi");
  const pidFile = path.join(process.env.PI_CODING_AGENT_DIR, "tab-session.pid");
  const trackedPi = path.join(process.env.PI_CODING_AGENT_DIR, "tab-session-pi.cjs");
  await writeFile(trackedPi, `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); require(${JSON.stringify(fakePi)});`);
  await config.update("pi.executable", trackedPi, vscode.ConfigurationTarget.Global);
  await config.update("session.closeWithEditorTab", true, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("frostpi.newSessionInEditorTab");
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(tab?.input instanceof vscode.TabInputWebview, "session opened as an editor tab");
  let pid;
  await waitFor(async () => {
    try { pid = Number(await readFile(pidFile, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return pid > 0;
  });
  assert.equal(await vscode.window.tabGroups.close(tab), true);
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { if (error.code === "ESRCH") return true; throw error; }
  });
}

module.exports = { run };
