import * as vscode from "vscode";

import { registerCommands } from "./commands/registerCommands.js";
import { createClientHost } from "./clientHost.js";
import { readConfiguration } from "@frostime/pi-client/host/readConfiguration";
import { SessionRegistry } from "@frostime/pi-client/host/SessionRegistry";
import { DiagnosticLogger } from "./diagnostics/DiagnosticLogger.js";
import { GIT_BASE_SCHEME, GitBaseContentProvider } from "./file-changes/GitBaseContentProvider.js";
import { SessionStatusBar } from "./status-bar/SessionStatusBar.js";
import { ProxySecretStore } from "./network/ProxySecretStore.js";
import { PiViewProvider } from "./webview-host/PiViewProvider.js";
import { SessionWebviewCoordinator } from "./webview-host/SessionWebviewCoordinator.js";

let registryForDeactivate: SessionRegistry | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new DiagnosticLogger("info");
  const proxyCredentials = new ProxySecretStore(context.secrets);
  const host = createClientHost(context, { logger, proxyCredentials });
  logger.setLevel(readConfiguration(host).diagnosticsLevel);
  const registry = new SessionRegistry(host, {
    logger,
    sessionTreeArtifactPath: context.asAbsolutePath("dist/pi-extensions/session-tree.js"),
    questionToolArtifactPath: context.asAbsolutePath("dist/pi-extensions/question-tool.js"),
  });
  const coordinator = new SessionWebviewCoordinator(registry, logger, context.extensionUri, () => host.proxyCredentials.get(), host);
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
        logger.setLevel(readConfiguration(host).diagnosticsLevel);
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
