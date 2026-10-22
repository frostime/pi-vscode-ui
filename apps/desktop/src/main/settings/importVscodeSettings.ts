import { posix, win32 } from "node:path";
import { desktopSettingDefinitions, type DesktopSettingsValues } from "../../shared/desktopSettings.js";
import { isSettingValueValid, proxyEndpointIssue, validateDesktopSettings } from "./validateDesktopSettings.js";

import { readSettingsObject } from "./readSettingsObject.js";
import { DesktopSettingsError } from "./DesktopSettingsError.js";
const PROXY_MODE = "frostpi.network.proxy.mode";
const PROXY_ENDPOINT = "frostpi.network.proxy.endpoint";

export function defaultVscodeSettingsPath(
  platform: NodeJS.Platform,
  home: string,
  appData?: string,
  xdgConfigHome?: string,
): string {
  if (platform === "win32") return win32.join(appData || win32.join(home, "AppData", "Roaming"), "Code", "User", "settings.json");
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "Code", "User", "settings.json");
  return posix.join(xdgConfigHome || posix.join(home, ".config"), "Code", "User", "settings.json");
}

/** Read only the explicitly supplied default-user file; never search Projects, Profiles, or Remote settings. */
export async function importVscodeSettings(filePath: string): Promise<{ values: DesktopSettingsValues; notices: string[] }> {
  let source: Record<string, unknown>;
  try {
    source = await readSettingsObject(filePath);
  } catch {
    throw new DesktopSettingsError("Cannot import VS Code settings. Check that the default user settings file is readable, valid JSONC, and at most 1 MiB.");
  }

  const values: DesktopSettingsValues = {};
  const notices: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(desktopSettingDefinitions, key)) continue;
    if (!isSettingValueValid(key, value)
      || (key === "frostpi.notifications.experimental.enabled" && value === true)
      || (key === PROXY_ENDPOINT && typeof value === "string" && value.trim() && proxyEndpointIssue(value))) {
      notices.push(key === "files.exclude" || key === "search.exclude"
        ? `Skipped the entire ${key} map because it contains an invalid entry.`
        : `Skipped invalid or unsupported value for ${key}.`);
      continue;
    }
    values[key] = value;
  }

  // Preserve the same precedence as shared readProxyEndpoint for settings from older FrostPi versions.
  if (!(typeof values[PROXY_ENDPOINT] === "string" && values[PROXY_ENDPOINT].trim())) {
    const legacy = ["frostpi.network.proxy.http", "frostpi.network.proxy.https", "frostpi.network.proxy.all"]
      .map((key) => source[key]).find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (legacy) {
      if (!proxyEndpointIssue(legacy)) {
        values[PROXY_ENDPOINT] = legacy;
        notices.push("Imported the legacy FrostPi proxy endpoint into frostpi.network.proxy.endpoint. Review it before saving.");
      } else {
        notices.push("Skipped an invalid or credential-bearing legacy FrostPi proxy endpoint. Configure frostpi.network.proxy.endpoint before saving.");
      }
    }
  }

  if (values[PROXY_MODE] === "vscode") {
    const endpoint = source["http.proxy"];
    if (typeof endpoint === "string" && endpoint.trim() && !proxyEndpointIssue(endpoint)) {
      values[PROXY_MODE] = "custom";
      values[PROXY_ENDPOINT] = endpoint;
      notices.push("Converted frostpi.network.proxy.mode from vscode to custom using http.proxy. Review the proxy before saving.");
    } else {
      notices.push("Cannot convert frostpi.network.proxy.mode from vscode using http.proxy. Choose a supported mode or enter a valid proxy endpoint before saving.");
    }
  }

  // Keep individually valid values in the preview even when a required dependency is missing.
  notices.push(...validateDesktopSettings(values));
  return { values, notices: [...new Set(notices)] };
}
