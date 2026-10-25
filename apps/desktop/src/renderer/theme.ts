import type { DesktopTheme } from "../shared/desktopSettings.js";

export function applyDesktopTheme(theme: DesktopTheme): void {
  document.documentElement.dataset.desktopTheme = theme;
  // Shared diagrams use the same theme-kind signal as VS Code Webviews.
  document.body.dataset.vscodeThemeKind = `vscode-${theme}`;
  document.body.classList.toggle("vscode-dark", theme === "dark");
  document.body.classList.toggle("vscode-light", theme === "light");
}
