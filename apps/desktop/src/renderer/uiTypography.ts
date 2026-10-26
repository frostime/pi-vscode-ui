import { desktopOnlySettingDefinitions, type DesktopSettingsValues } from "../shared/desktopSettings.js";

export function applyDesktopUiTypography(values: DesktopSettingsValues): void {
  const style = document.documentElement.style;
  const family = values["desktop.ui.fontFamily"];
  if (typeof family === "string" && family.trim() && family.trim() !== "default") style.setProperty("--vscode-font-family", family);
  else style.removeProperty("--vscode-font-family");
  const size = values["desktop.ui.fontSize"] ?? desktopOnlySettingDefinitions["desktop.ui.fontSize"]!.default;
  style.setProperty("--vscode-font-size", `${Number(size)}px`);
}
