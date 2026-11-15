import * as vscode from "vscode";

import { captureActiveFileReference } from "../composer/mentions/captureActiveFile.js";
import { captureActiveSelection } from "../composer/mentions/captureSelection.js";
import { configurePiExecutable } from "../configuration/configurePiExecutable.js";
import { exportDiagnostics } from "../diagnostics/exportDiagnostics.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { configureProxy, configureProxyCredentials } from "../network/configureProxy.js";
import { ProxySecretStore } from "../network/ProxySecretStore.js";
import type { SessionRegistry } from "@frostime/pi-client/host/SessionRegistry";
import { FILE_LINK_SECTION, linkTargetFromContext, WEB_LINK_SECTION, type LinkContextSection } from "@frostime/pi-client/shared/model/linkContextMenu";
import type { PiViewProvider } from "../webview-host/PiViewProvider.js";
import type { SessionWebviewCoordinator } from "../webview-host/SessionWebviewCoordinator.js";

/** A message link's context-menu entry copies the target the Webview resolved for it. */
async function copyLinkTarget(context: unknown, section: LinkContextSection): Promise<void> {
  const target = linkTargetFromContext(context, section);
  if (target) await vscode.env.clipboard.writeText(target);
}

export function registerCommands(
  context: vscode.ExtensionContext,
  registry: SessionRegistry,
  viewProvider: PiViewProvider,
  coordinator: SessionWebviewCoordinator,
  logger: DiagnosticLogger,
): void {
  const proxySecrets = new ProxySecretStore(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand("frostpi.focus", () => viewProvider.reveal()),
    vscode.commands.registerCommand("frostpi.copyLinkAddress", (context: unknown) => copyLinkTarget(context, WEB_LINK_SECTION)),
    vscode.commands.registerCommand("frostpi.copyLinkPath", (context: unknown) => copyLinkTarget(context, FILE_LINK_SECTION)),
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
      await coordinator.insertEditorReference(`${text} `);
    }),
    vscode.commands.registerCommand("frostpi.sendFile", async () => {
      const text = captureActiveFileReference();
      if (!text) {
        void vscode.window.showWarningMessage("Open a workspace file first.");
        return;
      }
      await coordinator.insertEditorReference(`${text} `);
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
