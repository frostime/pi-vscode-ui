import * as vscode from "vscode";

import { DEFAULT_NO_PROXY } from "../network/buildPiProcessEnvironment.js";
import type { FrostPiConfiguration } from "./configurationTypes.js";

export function readConfiguration(scope?: vscode.Uri): FrostPiConfiguration {
  const config = vscode.workspace.getConfiguration("frostpi", scope);
  const executable = config.get<string>("pi.executable", "").trim();
  return {
    ...(executable ? { piExecutable: executable } : {}),
    piArguments: config.get<string[]>("pi.arguments", []),
    startSessionOnOpen: config.get<boolean>("session.startOnOpen", true),
    streamingBehavior: config.get<"steer" | "followUp">("composer.streamingBehavior", "followUp"),
    collapseTurnTrace: config.get<boolean>("conversation.collapseTurnTrace", true),
    questionToolEnabled: config.get<boolean>("questionTool.enabled", false),
    maxImageBytes: config.get<number>("attachments.maxImageBytes", 10 * 1024 * 1024),
    diagnosticsLevel: config.get<"error" | "info" | "debug">("diagnostics.level", "info"),
    experimentalNotificationsEnabled: config.get<boolean>("notifications.experimental.enabled", false),
    proxy: {
      mode: config.get<"inherit" | "vscode" | "custom" | "direct">("network.proxy.mode", "inherit"),
      ...optional("endpoint", readProxyEndpoint(config)),
      // Keep package default / DEFAULT_NO_PROXY aligned so empty/missing still reach buildPiProcessEnvironment.
      ...optional("noProxy", config.get<string>("network.proxy.noProxy", DEFAULT_NO_PROXY)),
    },
    fileMentionRespectSearchExclude: config.get<boolean>("composer.fileMentions.respectSearchExclude", true),
    fileMentionRespectIgnoreFiles: config.get<boolean>("composer.fileMentions.respectIgnoreFiles", true),
    fileMentionFollowSymlinks: config.get<boolean>("composer.fileMentions.followSymlinks", true),
  };
}

function optional<Key extends string>(key: Key, value: string): Record<Key, string> | Record<string, never> {
  const normalized = value.trim();
  return normalized ? { [key]: normalized } as Record<Key, string> : {};
}

/** Prefer endpoint; fall back to pre-simplification http/https/all keys still present in settings.json. */
function readProxyEndpoint(config: vscode.WorkspaceConfiguration): string {
  return firstNonEmpty(
    config.get<string>("network.proxy.endpoint", ""),
    config.get<string>("network.proxy.http", ""),
    config.get<string>("network.proxy.https", ""),
    config.get<string>("network.proxy.all", ""),
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
