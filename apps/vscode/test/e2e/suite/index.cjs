const assert = require("node:assert/strict");
const path = require("node:path");
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
}

module.exports = { run };
