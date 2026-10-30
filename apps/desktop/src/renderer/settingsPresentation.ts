import { desktopSettingDefinitions, type SettingDefinition } from "../shared/desktopSettings.js";

export interface SettingPresentation {
  key: string;
  label: string;
  description: string;
  effect?: "Next Pi start" | "Next app launch";
  enumLabels?: Record<string, string>;
  disabledOptions?: readonly string[];
  unit?: string;
  scale?: number;
  placeholder?: string;
  unavailable?: boolean;
}

export interface SettingsSection {
  title: string;
  settings: readonly SettingPresentation[];
}

export interface SettingsPage {
  id: string;
  title: string;
  icon: string;
  description: string;
  sections: readonly SettingsSection[];
}

// Presentation only. Types, defaults and validation remain in the original-key
// schema; desktop.* settings can appear in any appropriate user-facing group.
export const settingsPages: readonly SettingsPage[] = [
  {
    id: "appearance", title: "Appearance", icon: "color-mode", description: "Theme and typography for this Desktop app.",
    sections: [
      { title: "Theme", settings: [
        { key: "desktop.theme", label: "Color theme", description: "Choose a built-in Desktop palette.", enumLabels: { dark: "Dark Modern", light: "Light Modern" } },
      ] },
      { title: "Interface", settings: [
        { key: "desktop.ui.fontFamily", label: "Interface font", description: "Sidebar, buttons, menus and settings. Default uses the system UI font; chat fonts set to Default also follow it.", placeholder: "default" },
        { key: "desktop.ui.fontSize", label: "Interface text size", description: "Resizes interface text, not Conversation or Composer text. Use Zoom to scale icons and spacing too.", unit: "px" },
        { key: "desktop.zoomFactor", label: "Zoom", description: "Scales the whole app content. Ctrl/Cmd + and - adjust by 10%; Ctrl/Cmd 0 resets to 100%.", unit: "%", scale: 0.01 },
      ] },
      { title: "Chat fonts", settings: [
        { key: "chat.fontFamily", label: "Conversation font", description: "Message text. Default follows the interface font.", placeholder: "default" },
        { key: "chat.fontSize", label: "Conversation text size", description: "Applies to message text and fenced code blocks.", unit: "px" },
        { key: "chat.editor.fontFamily", label: "Composer & code font", description: "Default uses the UI font in Composer, and the code fallback below for code blocks.", placeholder: "default" },
        { key: "chat.editor.fontSize", label: "Composer text size", description: "Only the input editor; message text size stays separate.", unit: "px" },
        { key: "editor.fontFamily", label: "Code font fallback", description: "Used for code when Composer & code font is Default." },
      ] },
    ],
  },
  {
    id: "agent", title: "Conversation & Pi", icon: "comment-discussion", description: "Conversation behavior and Pi startup.",
    sections: [
      { title: "Reading & input", settings: [
        { key: "frostpi.composer.streamingBehavior", label: "Prompts sent while Pi is running", description: "The Composer can override this per session.", enumLabels: { followUp: "Queue for after the turn", steer: "Deliver during the turn" } },
        { key: "frostpi.conversation.collapseTurnTrace", label: "Collapse completed turn details", description: "Group tools, reasoning and interim replies above the final answer." },
        { key: "frostpi.attachments.maxImageBytes", label: "Image attachment limit", description: "Maximum size of each pasted image.", unit: "MiB", scale: 1024 * 1024 },
      ] },
      { title: "Runtime", settings: [
        { key: "frostpi.pi.runtimeCompatibility", label: "Runtime compatibility", description: "Oh My Pi uses a limited compatibility profile, not its full TUI feature set.", effect: "Next Pi start", enumLabels: { pi: "Pi", "oh-my-pi": "Oh My Pi · limited" } },
        { key: "frostpi.pi.executable", label: "Pi executable", description: "Leave empty to find the selected runtime on PATH.", effect: "Next Pi start", placeholder: "Automatic · find on PATH" },
        { key: "frostpi.pi.arguments", label: "Launch arguments", description: "Additional tokens after --mode rpc. One array item per argument.", effect: "Next Pi start" },
      ] },
      { title: "Sessions & tools", settings: [
        { key: "frostpi.session.startOnOpen", label: "Start the last selected session on launch", description: "Starts an existing saved selection; never creates a new session.", effect: "Next app launch" },
        { key: "frostpi.questionTool.enabled", label: "FrostPi Question tool", description: "Allow Pi to ask structured questions through the shared UI.", effect: "Next Pi start" },
      ] },
    ],
  },
  {
    id: "network-files", title: "Network & files", icon: "globe", description: "Connection settings and file-discovery rules.",
    sections: [
      { title: "Connection", settings: [
        { key: "frostpi.network.proxy.mode", label: "Connection mode", description: "Inherit the environment, connect directly, or use a custom proxy.", effect: "Next Pi start", enumLabels: { inherit: "Inherit environment", direct: "Direct connection", custom: "Custom proxy", vscode: "VS Code proxy" }, disabledOptions: ["vscode"] },
        { key: "frostpi.network.proxy.endpoint", label: "Proxy address", description: "HTTP(S) or SOCKS endpoint. Do not include a username or password.", effect: "Next Pi start", placeholder: "http://127.0.0.1:7890" },
        { key: "frostpi.network.proxy.noProxy", label: "Bypass proxy for", description: "Comma-separated hosts. Local loopback addresses bypass the proxy by default.", effect: "Next Pi start" },
      ] },
      { title: "File mentions", settings: [
        { key: "frostpi.composer.fileMentions.respectIgnoreFiles", label: "Respect ignore files", description: "Hide matches from .gitignore, .ignore, .fdignore and global ignore rules." },
        { key: "frostpi.composer.fileMentions.respectSearchExclude", label: "Apply search exclusions to @mentions", description: "Also apply the search exclusion rules below." },
        { key: "frostpi.composer.fileMentions.followSymlinks", label: "Follow symbolic links", description: "Include paths reached through symlinks in @mention search." },
      ] },
      { title: "Exclusion rules", settings: [
        { key: "files.exclude", label: "File exclusion overrides", description: "Add patterns to hide. Use false to include a built-in excluded pattern." },
        { key: "search.exclude", label: "Search exclusion overrides", description: "Additional rules when Apply search exclusions to @mentions is on." },
      ] },
    ],
  },
  {
    id: "advanced", title: "Advanced", icon: "settings-gear", description: "Diagnostics and feature availability.",
    sections: [
      { title: "Diagnostics", settings: [
        { key: "frostpi.diagnostics.level", label: "Log detail level", description: "Controls diagnostic verbosity. Prompts and model content are not logged.", enumLabels: { error: "Errors only", info: "Standard", debug: "Debug" } },
      ] },
      { title: "Availability", settings: [
        { key: "frostpi.notifications.experimental.enabled", label: "Native notifications", description: "Not available in Desktop. This shared extension setting stays off.", unavailable: true },
      ] },
    ],
  },
];

export const settingsByKey: Readonly<Record<string, SettingPresentation>> = Object.fromEntries(
  settingsPages.flatMap((page) => page.sections.flatMap((section) => section.settings.map((setting) => [setting.key, setting]))),
);

export function matchesSettingSearch(setting: SettingPresentation, query: string): boolean {
  const definition = desktopSettingDefinitions[setting.key]!;
  const text = [setting.label, setting.description, setting.key, definition.description].join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

export function formatSettingValue(setting: SettingPresentation, definition: SettingDefinition, value: unknown): string {
  if (value === undefined) return "Use default";
  if (definition.enum && typeof value === "string") return setting.enumLabels?.[value] ?? value;
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return `${value / (setting.scale ?? 1)}${setting.unit ? ` ${setting.unit}` : ""}`;
  if (value === "") return "Empty";
  return typeof value === "string" ? value : JSON.stringify(value) ?? "Unavailable";
}
