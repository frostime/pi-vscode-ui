import { clipboard, dialog, nativeTheme, shell } from "electron";
import type { BrowserWindow } from "electron";
import type { DesktopNative } from "./desktopNative.js";

export function electronNative(window: () => BrowserWindow | undefined): DesktopNative {
  return {
    focused: () => window()?.isFocused() ?? false,
    message: async (type, message) => { const target = window(); if (target) await dialog.showMessageBox(target, { type, message }); },
    confirm: async (type, message, actions) => {
      const target = window(); if (!target) return undefined;
      const result = await dialog.showMessageBox(target, { type, message, buttons: [...actions, "Cancel"], cancelId: actions.length, noLink: true });
      return result.response < actions.length ? actions[result.response] : undefined;
    },
    openFiles: async (options) => {
      const target = window(); if (!target) return undefined;
      const result = await dialog.showOpenDialog(target, {
        properties: ["openFile"], ...(options.title ? { title: options.title } : {}),
        ...(options.defaultFsPath ? { defaultPath: options.defaultFsPath } : {}),
        ...(options.filters ? { filters: Object.entries(options.filters).map(([name, extensions]) => ({ name, extensions: [...extensions] })) } : {}),
      });
      return result.canceled ? undefined : result.filePaths;
    },
    chooseDirectory: async () => {
      const target = window(); if (!target) return undefined;
      const result = await dialog.showOpenDialog(target, { title: "Add Project", properties: ["openDirectory"] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    writeClipboard: async (text) => { await clipboard.writeText(text); },
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    appearance: (theme, background, zoom) => {
      nativeTheme.themeSource = theme;
      const target = window(); if (!target) return;
      target.setBackgroundColor(background);
      target.webContents.setZoomMode("isolated");
      target.webContents.setZoomFactor(zoom);
    },
  };
}
