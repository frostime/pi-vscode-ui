import * as vscode from "vscode";

import { readConfiguration } from "./configuration/readConfiguration.js";
import { registerCommands } from "./commands/registerCommands.js";
import { DiagnosticLogger } from "./diagnostics/DiagnosticLogger.js";
import { GIT_BASE_SCHEME, GitBaseContentProvider } from "./file-changes/GitBaseContentProvider.js";
import { SessionStatusBar } from "./status-bar/SessionStatusBar.js";
import { SessionRegistry } from "./sessions/SessionRegistry.js";
import { PiViewProvider } from "./webview-host/PiViewProvider.js";
import { SessionWebviewCoordinator } from "./webview-host/SessionWebviewCoordinator.js";

let registryForDeactivate: SessionRegistry | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new DiagnosticLogger(readConfiguration().diagnosticsLevel);
  const registry = new SessionRegistry(context, logger);
  const coordinator = new SessionWebviewCoordinator(registry, logger, context.extensionUri);
  const viewProvider = new PiViewProvider(context.extensionUri, coordinator);
  const gitBaseProvider = new GitBaseContentProvider();
  const statusBar = new SessionStatusBar(registry);
  registryForDeactivate = registry;

  context.subscriptions.push(
    logger,
    coordinator,
    statusBar,
    gitBaseProvider,
    vscode.workspace.registerTextDocumentContentProvider(GIT_BASE_SCHEME, gitBaseProvider),
    vscode.window.registerWebviewViewProvider(PiViewProvider.viewType, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("frostpi.diagnostics.level")) {
        logger.setLevel(readConfiguration().diagnosticsLevel);
      }
      // Proxy/attachment/file-mention changes update live session view labels/limits; process env still applies only after restart.
      if (
        event.affectsConfiguration("frostpi.network.proxy")
        || event.affectsConfiguration("http.proxy")
        || event.affectsConfiguration("frostpi.attachments")
        || event.affectsConfiguration("frostpi.composer.fileMentions")
        || event.affectsConfiguration("frostpi.questionTool")
      ) {
        registry.refreshConfigurationState();
      }
    }),
  );

  registerCommands(context, registry, viewProvider, coordinator, logger);
  logger.info("FrostPi extension activated");
  try {
    await registry.ensureInitialSession();
  } catch (error) {
    logger.error("Initial Pi session failed to start; FrostPi remains available for recovery", error);
  }
}

export async function deactivate(): Promise<void> {
  await registryForDeactivate?.dispose();
  registryForDeactivate = undefined;
}
