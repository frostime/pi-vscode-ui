import type { ProxyMode } from "../core/network/proxyConfiguration.js";
import { frostPiSettingDefaults as defaults } from "../core/configuration/frostPiSettingDefaults.generated.js";
import type { FrostPiConfiguration } from "../core/configuration/configurationTypes.js";
import { isRuntimeCompatibility } from "../core/configuration/runtimeCompatibility.js";
import type { ClientHost, HostConfiguration } from "./clientHost.js";

/**
 * Single-source FrostPi settings parsing over a host-shape `getConfiguration(section, scope)` hook.
 * Defaults are generated from the VS Code settings schema. Hosts supply values of the same
 * keys, never re-declare defaults.
 */
export function readConfiguration(host: ClientHost, scope?: string): FrostPiConfiguration {
  const config = host.configuration.getConfiguration("frostpi", scope);
  const executable = config.get<string>("pi.executable", defaults["pi.executable"]).trim();
  const runtimeCompatibility = config.get<unknown>("pi.runtimeCompatibility", defaults["pi.runtimeCompatibility"]);
  return {
    ...(executable ? { piExecutable: executable } : {}),
    runtimeCompatibility: isRuntimeCompatibility(runtimeCompatibility) ? runtimeCompatibility : defaults["pi.runtimeCompatibility"],
    piArguments: config.get<string[]>("pi.arguments", [...defaults["pi.arguments"]]),
    startSessionOnOpen: config.get<boolean>("session.startOnOpen", defaults["session.startOnOpen"]),
    streamingBehavior: config.get<"steer" | "followUp">("composer.streamingBehavior", defaults["composer.streamingBehavior"]),
    collapseTurnTrace: config.get<boolean>("conversation.collapseTurnTrace", defaults["conversation.collapseTurnTrace"]),
    questionToolEnabled: config.get<boolean>("questionTool.enabled", defaults["questionTool.enabled"]),
    maxImageBytes: config.get<number>("attachments.maxImageBytes", defaults["attachments.maxImageBytes"]),
    diagnosticsLevel: config.get<"error" | "info" | "debug">("diagnostics.level", defaults["diagnostics.level"]),
    experimentalNotificationsEnabled: config.get<boolean>("notifications.experimental.enabled", defaults["notifications.experimental.enabled"]),
    proxy: {
      mode: config.get<ProxyMode>("network.proxy.mode", defaults["network.proxy.mode"]),
      ...optional("endpoint", readProxyEndpoint(config)),
      ...optional("noProxy", config.get<string>("network.proxy.noProxy", defaults["network.proxy.noProxy"])),
    },
    fileMentionRespectSearchExclude: config.get<boolean>("composer.fileMentions.respectSearchExclude", defaults["composer.fileMentions.respectSearchExclude"]),
    fileMentionRespectIgnoreFiles: config.get<boolean>("composer.fileMentions.respectIgnoreFiles", defaults["composer.fileMentions.respectIgnoreFiles"]),
    fileMentionFollowSymlinks: config.get<boolean>("composer.fileMentions.followSymlinks", defaults["composer.fileMentions.followSymlinks"]),
  };
}

/** Reads the real host proxy value used for `proxy.mode: "vscode"` (VS Code `http.proxy`). */
export function readHostProxy(host: ClientHost, scope?: string): string | undefined {
  const value = host.configuration.getConfiguration("http", scope).get<string>("proxy", "").trim();
  return value || undefined;
}

function optional<Key extends string>(key: Key, value: string): Record<Key, string> | Record<string, never> {
  const normalized = value.trim();
  return normalized ? { [key]: normalized } as Record<Key, string> : {};
}

/** Prefer endpoint; fall back to pre-simplification http/https/all keys still present in settings.json. */
function readProxyEndpoint(config: HostConfiguration): string {
  return firstNonEmpty(
    config.get<string>("network.proxy.endpoint", defaults["network.proxy.endpoint"]),
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
