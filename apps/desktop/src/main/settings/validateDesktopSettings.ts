import { Ajv } from "ajv";
import { normalizeProxyEndpoint } from "@frostime/pi-client/core/network/buildPiProcessEnvironment";
import { desktopSettingDefinitions } from "../../shared/desktopSettings.js";

// VS Code schemas carry editor-only annotations such as scope and enumDescriptions.
const ajv = new Ajv({ strict: false, allErrors: true });
const settingValidators = Object.fromEntries(Object.entries(desktopSettingDefinitions)
  .map(([key, definition]) => [key, ajv.compile(definition)]));
const validate = ajv.compile({
  type: "object",
  properties: desktopSettingDefinitions,
  additionalProperties: false,
});

/** Import checks individual values before resolving cross-setting dependencies such as proxy mode. */
export function isSettingValueValid(key: string, value: unknown): boolean {
  return Object.hasOwn(settingValidators, key) && settingValidators[key]!(value);
}

/** Messages name keys, never rejected values (which may contain a credential). */
export function validateDesktopSettings(values: unknown): string[] {
  if (!validate(values)) {
    return [...new Set((validate.errors ?? []).map((error) => {
      const key = error.keyword === "additionalProperties"
        ? String((error.params as { additionalProperty: string }).additionalProperty)
        : error.instancePath.split("/")[1]?.replaceAll("~1", "/").replaceAll("~0", "~");
      // Unknown property names are untrusted too; do not echo arbitrary input into diagnostics.
      return key && Object.hasOwn(desktopSettingDefinitions, key)
        ? `Invalid value for ${key}.`
        : "Settings must be an object containing only supported setting keys.";
    }))];
  }
  const settings = values as Record<string, unknown>;
  const issues: string[] = [];
  if (settings["frostpi.network.proxy.mode"] === "vscode") {
    issues.push("frostpi.network.proxy.mode 'vscode' requires VS Code. Choose inherit, custom, or direct.");
  }
  if (settings["frostpi.notifications.experimental.enabled"] === true) {
    issues.push("frostpi.notifications.experimental.enabled is not supported in Desktop yet.");
  }
  const endpoint = settings["frostpi.network.proxy.endpoint"] as string | undefined;
  if (endpoint?.trim() || settings["frostpi.network.proxy.mode"] === "custom") {
    const issue = proxyEndpointIssue(endpoint);
    if (issue) issues.push(issue);
  }
  return issues;
}

export function proxyEndpointIssue(endpoint: string | undefined): string | undefined {
  const normalized = normalizeProxyEndpoint(endpoint);
  if (!normalized) return "A custom proxy requires frostpi.network.proxy.endpoint.";
  try {
    const url = new URL(normalized);
    if (url.username || url.password) return "Proxy credentials cannot be stored in Desktop settings. Use a proxy endpoint without credentials.";
    if (!["http:", "https:", "socks:", "socks5:", "socks5h:"].includes(url.protocol)) {
      return "Use an HTTP(S) or SOCKS proxy endpoint.";
    }
    if (!url.hostname) return "Enter a valid proxy endpoint.";
  } catch {
    return "Enter a valid proxy endpoint.";
  }
  return undefined;
}
