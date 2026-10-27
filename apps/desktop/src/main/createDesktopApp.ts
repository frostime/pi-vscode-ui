import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createDesktopBackend } from "./createDesktopBackend.js";
import type { DesktopBackendOptions } from "./createDesktopBackend.js";
import { electronNative } from "./electronNative.js";
import { installWindowZoom } from "./windowZoom.js";

export type DesktopAppOptions = Partial<Pick<DesktopBackendOptions, "directories" | "settingsStore" | "stateStore" | "vscodeSettingsPath" | "discoverWorkingDirectories">> & { show?: boolean };

/** Electron remains available as the migration baseline until the Tauri candidate passes native verification. */
export async function createDesktopApp(options: DesktopAppOptions = {}) {
  const window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 280, minHeight: 400, show: false,
    title: "FrostPi Desktop", backgroundColor: "#1f1f1f",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const authorized = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const backend = await createDesktopBackend({
    ...options, profile: app.getPath("userData"), artifacts: __dirname,
    clientVersion: app.isPackaged ? app.getVersion() : "unknown",
    native: electronNative(() => window.isDestroyed() ? undefined : window),
    transport: {
      publish: (channel, value) => { if (!window.isDestroyed()) window.webContents.send(channel, value); },
      visible: () => !window.isDestroyed() && !window.isMinimized(),
      onVisibility: (listener) => {
        const hide = () => listener(false); const show = () => listener(true);
        window.on("minimize", hide); window.on("restore", show);
        return () => { window.removeListener("minimize", hide); window.removeListener("restore", show); };
      },
      listen: (channel, action) => {
        const listener = (event: Electron.IpcMainEvent, ...values: unknown[]): void => { if (authorized(event)) void action(...values); };
        ipcMain.on(channel, listener);
        return () => { ipcMain.removeListener(channel, listener); };
      },
      handle: (channel, action) => {
        ipcMain.handle(channel, (event, value: unknown) => { if (!authorized(event)) throw new Error("Unauthorized Desktop request."); return action(value); });
        return () => ipcMain.removeHandler(channel);
      },
    },
  });
  const disposeZoom = installWindowZoom(window, backend.settingsStore, () => backend.connection.post({ type: "toast", level: "error", message: "Could not save Desktop zoom." }));
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    try { await disposeZoom(); await backend.dispose(); }
    catch { dialog.showErrorBox("FrostPi Desktop state", `Could not finish saving application state. Check ${backend.stateStore.filePath}`); }
    finally { if (!window.isDestroyed()) window.destroy(); }
  })();
  window.on("close", (event) => { event.preventDefault(); void close(); });
  window.webContents.on("render-process-gone", () => { void close(); });
  try { await window.loadFile(join(__dirname, "renderer/index.html")); if (options.show ?? true) window.show(); }
  catch (error) { await close(); throw error; }
  return { window, ...backend };
}
