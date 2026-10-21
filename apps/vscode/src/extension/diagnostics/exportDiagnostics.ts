import * as vscode from "vscode";

import type { DiagnosticLogger } from "./DiagnosticLogger.js";
import { redactDiagnosticText } from "@frostime/pi-client/core/diagnostics/diagnosticRedaction";

export async function exportDiagnostics(logger: DiagnosticLogger, sessionSummary: string): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    title: "Export FrostPi Diagnostics",
    defaultUri: vscode.Uri.file(`frostpi-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.txt`),
    filters: { "Text files": ["txt"] },
  });
  if (!target) return;
  const body = redactDiagnosticText(`${logger.contentsHeader()}\n\n${sessionSummary}\n`);
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, "utf8"));
  void vscode.window.showInformationMessage("FrostPi diagnostics exported.");
}
