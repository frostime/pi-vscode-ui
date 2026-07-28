import * as vscode from "vscode";

export async function configurePiExecutable(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("frostpi");
  const current = configuration.get<string>("pi.executable", "");
  const value = await vscode.window.showInputBox({
    title: "Configure Pi executable",
    prompt: "Enter `pi`, an absolute executable path, or Pi's compiled cli.js path. Leave blank for PATH discovery.",
    value: current,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;
  await configuration.update("pi.executable", value.trim(), vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage("FrostPi executable setting updated. Restart failed sessions to apply it.");
}
