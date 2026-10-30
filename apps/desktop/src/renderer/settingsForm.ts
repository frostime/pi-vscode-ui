import { desktopSettingDefinitions, type DesktopSettingsValues } from "../shared/desktopSettings.js";
import { settingsByKey } from "./settingsPresentation.js";

/** Only explicit overrides are present. Text preserves unfinished numbers and JSON until Save. */
export type SettingsDraft = Record<string, string | boolean>;

export function createSettingsDraft(values: DesktopSettingsValues): SettingsDraft {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const definition = desktopSettingDefinitions[key]!;
    const scale = settingsByKey[key]?.scale ?? 1;
    const displayed = definition.type === "boolean" ? value as boolean
      : definition.type === "number" ? String(Number(value) / scale)
        : definition.type === "array" || definition.type === "object" ? JSON.stringify(value, null, 2)
          : String(value);
    return [key, displayed];
  }));
}

export function settingDraftValue(key: string, draft: SettingsDraft): string | boolean {
  // Reading an absent key subscribes Svelte to its first override. hasOwn on a
  // missing proxy property does not; false and empty strings are still explicit.
  const explicit = draft[key];
  if (explicit !== undefined) return explicit;
  const definition = desktopSettingDefinitions[key]!;
  // Maps edit overrides, not a copied set of built-in exclusion defaults.
  if (definition.type === "object") return "{}";
  return createSettingsDraft({ [key]: definition.default })[key]!;
}

export function changedSettingKeys(saved: SettingsDraft, draft: SettingsDraft): string[] {
  return [...new Set([...Object.keys(saved), ...Object.keys(draft)])].filter((key) => saved[key] !== draft[key]);
}

/** Adopt external updates (for example Zoom shortcuts) only for fields the user has not edited. */
export function mergeSettingsDraft(saved: SettingsDraft, draft: SettingsDraft, values: DesktopSettingsValues): { saved: SettingsDraft; draft: SettingsDraft } {
  const incoming = createSettingsDraft(values);
  const merged = { ...incoming };
  for (const key of changedSettingKeys(saved, draft)) {
    if (draft[key] === undefined) delete merged[key];
    else merged[key] = draft[key];
  }
  return { saved: incoming, draft: merged };
}

export function parseSettingsDraft(draft: SettingsDraft): { values: DesktopSettingsValues; errors: Record<string, string> } {
  const values: DesktopSettingsValues = {};
  const errors: Record<string, string> = {};
  for (const [key, text] of Object.entries(draft)) {
    const definition = desktopSettingDefinitions[key]!;
    const setting = settingsByKey[key]!;
    let value: unknown = text;
    if (definition.type === "array" || definition.type === "object") {
      try {
        value = JSON.parse(String(text));
        if (definition.type === "array" ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
      } catch {
        errors[key] = `Enter valid JSON with the required ${definition.type} structure.`;
        continue;
      }
    } else if (definition.type === "number") {
      const scale = setting.scale ?? 1;
      value = Number(text) * scale;
      if (String(text).trim() === "" || !Number.isFinite(value)
        || (definition.minimum !== undefined && Number(value) < definition.minimum)
        || (definition.maximum !== undefined && Number(value) > definition.maximum)) {
        errors[key] = `Enter a number${definition.minimum !== undefined ? ` from ${definition.minimum / scale}` : ""}${definition.maximum !== undefined ? ` to ${definition.maximum / scale}` : ""}${setting.unit ? ` ${setting.unit}` : ""}.`;
        continue;
      }
    }
    if (definition.enum && !definition.enum.includes(String(value))) errors[key] = "Choose a listed option.";
    if (typeof value === "string" && setting.disabledOptions?.includes(value)) errors[key] = "This option is unavailable in Desktop. Choose another option or Reset.";
    if (setting.unavailable && value !== definition.default) errors[key] = "This setting is unavailable in Desktop. Use Reset.";
    values[key] = value;
  }
  const endpoint = values["frostpi.network.proxy.endpoint"];
  if (values["frostpi.network.proxy.mode"] === "custom" && (typeof endpoint !== "string" || !endpoint.trim())) {
    errors["frostpi.network.proxy.endpoint"] = "Enter a proxy address, or choose another connection mode.";
  }
  return { values, errors };
}
