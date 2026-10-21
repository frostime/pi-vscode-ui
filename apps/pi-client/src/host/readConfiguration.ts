import { DEFAULT_NO_PROXY, type ProxyMode } from "../core/network/proxyConfiguration.js";
import type { FrostPiConfiguration } from "../core/configuration/configurationTypes.js";
import { isRuntimeCompatibility } from "../core/configuration/runtimeCompatibility.js";
import type { ClientHost, HostConfiguration } from "./clientHost.js";

/**
 * Single-source FrostPi settings parsing over a host-shape `getConfiguration(section, scope)` hook.
 * Key names, types, and defaults live exactly here — hosts (fixing on VS Code or Desktop) must
 * supply values of the same keys, never re-declare defaults.
 */
export function readConfiguration(host: ClientHost, scope?: string): FrostPiConfiguration {
  const config = host.configuration.getConfiguration("frostpi", scope);
  const executable = config.get<string>("pi.executable", "").trim();
  const runtimeCompatibility = config.get<unknown>("pi.runtimeCompatibility", "pi");
  return {
    ...(executable ? { piExecutable: executable } : {}),
    runtimeCompatibility: isRuntimeCompatibility(runtimeCompatibility) ? runtimeCompatibility : "pi",
    piArguments: config.get<string[]>("pi.arguments", []),
    startSessionOnOpen: config.get<boolean>("session.startOnOpen", true),
    streamingBehavior: config.get<"steer" | "followUp">("composer.streamingBehavior", "followUp"),
    collapseTurnTrace: config.get<boolean>("conversation.collapseTurnTrace", true),
    questionToolEnabled: config.get<boolean>("questionTool.enabled", false),
    maxImageBytes: config.get<number>("attachments.maxImageBytes", 10 * 1024 * 1024),
    diagnosticsLevel: config.get<"error" | "info" | "debug">("diagnostics.level", "info"),
    experimentalNotificationsEnabled: config.get<boolean>("notifications.experimental.enabled", false),
    proxy: {
      mode: config.get<ProxyMode>("network.proxy.mode", "inherit"),
      ...optional("endpoint", readProxyEndpoint(config)),
      // Keep package default / DEFAULT_NO_PROXY aligned so empty/missing still reach buildPiProcessEnvironment.
      ...optional("noProxy", config.get<string>("network.proxy.noProxy", DEFAULT_NO_PROXY)),
    },
    fileMentionRespectSearchExclude: config.get<boolean>("composer.fileMentions.respectSearchExclude", true),
    fileMentionRespectIgnoreFiles: config.get<boolean>("composer.fileMentions.respectIgnoreFiles", true),
    fileMentionFollowSymlinks: config.get<boolean>("composer.fileMentions.followSymlinks", true),
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
