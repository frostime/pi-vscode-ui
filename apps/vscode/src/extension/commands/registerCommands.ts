import * as vscode from "vscode";

import { captureActiveFileReference } from "../composer/mentions/captureActiveFile.js";
import { captureActiveSelection } from "../composer/mentions/captureSelection.js";
import { configurePiExecutable } from "../configuration/configurePiExecutable.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import { exportDiagnostics } from "../diagnostics/exportDiagnostics.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { configureProxy, configureProxyCredentials } from "../network/configureProxy.js";
import { ProxySecretStore } from "../network/ProxySecretStore.js";
import type { SessionRegistry } from "@frostime/pi-client/host/SessionRegistry";
import type { PiViewProvider } from "../webview-host/PiViewProvider.js";
import type { SessionWebviewCoordinator } from "../webview-host/SessionWebviewCoordinator.js";

/** A window command has no Webview to report to, so its failure becomes a native message. */
async function reportFailure(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
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
    vscode.commands.registerCommand("frostpi.newSession", async () => {
      const sessionId = await registry.createSession();
      if (sessionId) await viewProvider.reveal();
    }),
    vscode.commands.registerCommand("frostpi.newSessionInEditorTab", () => reportFailure(() => coordinator.createSessionInPanel())),
    vscode.commands.registerCommand("frostpi.renameSession", () => reportFailure(async () => {
      const sessionId = coordinator.commandTargetSessionId();
      const session = sessionId ? registry.sessionView(sessionId) : null;
      if (!sessionId || !session) {
        void vscode.window.showInformationMessage("Open a FrostPi session first.");
        return;
      }
      const name = await vscode.window.showInputBox({
        title: "Rename FrostPi session",
        value: session.title,
        valueSelection: [0, session.title.length],
        validateInput: (value) => value.trim().length > 160 ? "A session name can have at most 160 characters." : undefined,
      });
      const normalized = name?.trim();
      if (!normalized || normalized === session.title) return;
      await registry.rename(sessionId, normalized);
    })),
    vscode.commands.registerCommand("frostpi.toggleFocusView", () => reportFailure(async () => {
      // Read and write in the scope of the Session the command means, at the level its
      // effective value comes from, so the toggle changes what that Session shows.
      const sessionId = coordinator.commandTargetSessionId();
      const sessionScope = sessionId ? registry.configurationScope(sessionId) : undefined;
      const scope = sessionScope ? workspaceUriForPath(sessionScope) : vscode.workspace.workspaceFolders?.[0]?.uri;
      const configuration = vscode.workspace.getConfiguration("frostpi", scope);
      const inspected = configuration.inspect<boolean>("conversation.focusView");
      const target = inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      await configuration.update("conversation.focusView", !configuration.get<boolean>("conversation.focusView", true), target);
    })),
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
