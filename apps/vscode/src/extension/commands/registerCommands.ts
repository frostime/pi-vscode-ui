import * as vscode from "vscode";

import { captureActiveFileReference } from "../composer/mentions/captureActiveFile.js";
import { captureActiveSelection } from "../composer/mentions/captureSelection.js";
import { configurePiExecutable } from "../configuration/configurePiExecutable.js";
import { exportDiagnostics } from "../diagnostics/exportDiagnostics.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { configureProxy, configureProxyCredentials } from "../network/configureProxy.js";
import { ProxySecretStore } from "../network/ProxySecretStore.js";
import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import type { PiViewProvider } from "../webview-host/PiViewProvider.js";
import type { WebviewBridge } from "../webview-host/WebviewBridge.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  registry: SessionRegistry,
  viewProvider: PiViewProvider,
  bridge: WebviewBridge,
  logger: DiagnosticLogger,
): void {
  const proxySecrets = new ProxySecretStore(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand("frostpi.focus", () => viewProvider.reveal()),
    vscode.commands.registerCommand("frostpi.newSession", async () => {
      const sessionId = await registry.createSession();
      if (sessionId) await viewProvider.reveal();
    }),
    vscode.commands.registerCommand("frostpi.resumeSession", async () => {
      const sessionId = await registry.resumeSession();
      if (sessionId) await viewProvider.reveal();
    }),
    vscode.commands.registerCommand("frostpi.sendSelection", async () => {
      const text = captureActiveSelection();
      if (!text) {
        void vscode.window.showWarningMessage("Open a workspace file first.");
        return;
      }
      await viewProvider.reveal();
      bridge.insertPromptText(`${text} `);
    }),
    vscode.commands.registerCommand("frostpi.sendFile", async () => {
      const text = captureActiveFileReference();
      if (!text) {
        void vscode.window.showWarningMessage("Open a workspace file first.");
        return;
      }
      await viewProvider.reveal();
      bridge.insertPromptText(`${text} `);
    }),
    vscode.commands.registerCommand("frostpi.stop", () => registry.abort()),
    vscode.commands.registerCommand("frostpi.restartSession", () => registry.retrySession()),
    vscode.commands.registerCommand("frostpi.restartAllSessions", () => registry.restartAllSessions()),
    vscode.commands.registerCommand("frostpi.configureProxy", () => configureProxy(registry, proxySecrets)),
    vscode.commands.registerCommand("frostpi.configureProxyCredentials", () => configureProxyCredentials(registry, proxySecrets)),
    vscode.commands.registerCommand("frostpi.exportDiagnostics", () => exportDiagnostics(logger, registry.diagnosticsSummary())),
    vscode.commands.registerCommand("frostpi.configureExecutable", () => configurePiExecutable()),
  );
}
