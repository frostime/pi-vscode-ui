import { frostPiSettingDefinitions } from "@frostime/pi-client/shared/configuration/frostPiSettingDefinitions.generated";
import { chatTypographyDefaults } from "@frostime/pi-client/shared/model/chatTypography";

/** Original VS Code names are the storage and UI keys. Desktop-only keys belong under desktop.*. */
export type DesktopSettingsValues = Record<string, unknown>;

export const desktopThemes = {
  dark: { label: "Dark Modern", background: "#181818" },
  light: { label: "Light Modern", background: "#f8f8f8" },
} as const;
export type DesktopTheme = keyof typeof desktopThemes;

export function readDesktopTheme(values: DesktopSettingsValues): DesktopTheme {
  return values["desktop.theme"] === "light" ? "light" : "dark";
}

export const desktopZoom = { default: 1, minimum: 0.5, maximum: 2, step: 0.1 } as const;

export function readDesktopZoom(values: DesktopSettingsValues): number {
  const factor = values["desktop.zoomFactor"];
  return typeof factor === "number" ? factor : desktopZoom.default;
}

export interface SettingDefinition {
  type: "string" | "number" | "boolean" | "array" | "object";
  default: unknown;
  description: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  items?: object;
  additionalProperties?: object;
}

const excludeRule = {
  anyOf: [
    { type: "boolean" },
    { type: "object", properties: { when: { type: "string" } }, additionalProperties: false },
  ],
};

/** These are the VS Code settings actually consumed by FrostPi, not a copy of editor.*. */
export const relatedVscodeSettingDefinitions: Record<string, SettingDefinition> = {
  "chat.fontFamily": { type: "string", default: chatTypographyDefaults["chat.fontFamily"], description: "Conversation font family. 'default' follows the interface font." },
  "chat.fontSize": { type: "number", default: chatTypographyDefaults["chat.fontSize"], minimum: 6, maximum: 100, description: "Conversation and fenced code block font size in pixels." },
  "chat.editor.fontFamily": { type: "string", default: chatTypographyDefaults["chat.editor.fontFamily"], description: "Composer font family; also used for conversation code. 'default' uses the UI font in the composer and editor.fontFamily for code." },
  "chat.editor.fontSize": { type: "number", default: chatTypographyDefaults["chat.editor.fontSize"], minimum: 6, maximum: 100, description: "Composer font size in pixels." },
  "editor.fontFamily": { type: "string", default: "Consolas, 'Courier New', monospace", description: "Fallback font family for code and other monospace text." },
  "files.exclude": { type: "object", default: { "**/.git": true, "**/.svn": true, "**/.hg": true, "**/.jj": true, "**/.DS_Store": true, "**/Thumbs.db": true }, additionalProperties: excludeRule, description: "Glob patterns excluded from @ file completion. Entries override the built-in exclusion map." },
  "search.exclude": { type: "object", default: { "**/node_modules": true, "**/bower_components": true, "**/*.code-search": true }, additionalProperties: excludeRule, description: "Additional @ file exclusions when respectSearchExclude is enabled. Entries override the built-in exclusion map." },
};

// Add actual Desktop-only preferences here under desktop.*. Their renderer
// labels and groups are separate from this schema and do not rename the keys.
export const desktopOnlySettingDefinitions: Record<string, SettingDefinition> = {
  "desktop.theme": { type: "string", default: "dark", enum: Object.keys(desktopThemes), description: "Desktop color theme: dark uses Dark Modern; light uses Light Modern. Changes apply immediately without restarting Pi." },
  "desktop.ui.fontFamily": { type: "string", default: "default", description: "Font family for Desktop interface text. Default uses the system UI font. Explicit Conversation and Composer fonts stay independent." },
  "desktop.ui.fontSize": { type: "number", default: 13, minimum: 10, maximum: 24, description: "Base size of interface text in pixels. Conversation and Composer text sizes stay independent." },
  "desktop.zoomFactor": { type: "number", default: desktopZoom.default, minimum: desktopZoom.minimum, maximum: desktopZoom.maximum, description: "Scale the whole Desktop content, including text, icons and spacing. Ctrl/Cmd +, - and 0 update this preference." },
};

export const desktopSettingDefinitions: Record<string, SettingDefinition> = {
  ...frostPiSettingDefinitions,
  ...relatedVscodeSettingDefinitions,
  ...desktopOnlySettingDefinitions,
};

/** Main chooses one known field; this is not a renderer-supplied path or VS Code search grammar. */
export type DesktopSettingsTarget = "all" | "frostpi.network.proxy.mode" | "frostpi.pi.executable";

export interface DesktopSettingsView {
  values: DesktopSettingsValues;
  filePath: string;
  firstRun: boolean;
  notices: string[];
  error?: string;
}

export type DesktopSettingsResult =
  | { ok: true; view: DesktopSettingsView }
  | { ok: false; error: string };

export type DesktopSettingsAction =
  | { type: "read" }
  | { type: "save"; values: DesktopSettingsValues }
  | { type: "setTheme"; theme: DesktopTheme }
  | { type: "importVscode" }
  | { type: "useDefaults" }
  | { type: "openFile" }
  | { type: "reload" };
