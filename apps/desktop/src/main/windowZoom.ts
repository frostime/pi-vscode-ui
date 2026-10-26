import type { BrowserWindow } from "electron";
import { desktopZoom, readDesktopZoom } from "../shared/desktopSettings.js";
import type { DesktopSettingsStore } from "./settings/DesktopSettingsStore.js";

type ZoomAction = "in" | "out" | "reset";

/** One saved preference owns native zoom, including shortcuts; windows must not share per-origin zoom. */
export function installWindowZoom(window: BrowserWindow, store: DesktopSettingsStore, reportError: () => void): () => Promise<void> {
  const contents = window.webContents;
  // Electron's manual mode changes the reported factor without scaling the page.
  contents.setZoomMode("isolated");
  let pending = Promise.resolve();
  const apply = (): void => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    const desired = readDesktopZoom(store.values);
    if (Math.abs(contents.getZoomFactor() - desired) > 1e-6) contents.setZoomFactor(desired);
  };
  const change = (action: ZoomAction): void => {
    // A shortcut must not initialize settings and consume the first-run import offer.
    if (store.firstRun || store.error) return;
    pending = pending.then(async () => {
      if (store.firstRun || store.error) return;
      if (action === "reset") {
        if (store.values["desktop.zoomFactor"] !== undefined) await store.update("desktop.zoomFactor", undefined);
        return;
      }
      // Read inside the queue so rapid key repeats do not overwrite each other's increments.
      const current = readDesktopZoom(store.values);
      const next = Math.min(desktopZoom.maximum, Math.max(desktopZoom.minimum,
        Number((current + (action === "in" ? desktopZoom.step : -desktopZoom.step)).toFixed(10))));
      if (next !== current) await store.update("desktop.zoomFactor", next);
    }).catch(() => { apply(); reportError(); });
  };
  const onKey = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type !== "keyDown" || input.isComposing || input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return;
    let action: ZoomAction;
    if (["+", "="].includes(input.key) || ["Equal", "NumpadAdd"].includes(input.code)) action = "in";
    else if (input.key === "-" || ["Minus", "NumpadSubtract"].includes(input.code)) action = "out";
    else if (input.key === "0" || ["Digit0", "Numpad0"].includes(input.code)) action = "reset";
    else return;
    event.preventDefault();
    change(action);
  };
  const onWheelZoom = (_event: Electron.Event, direction: "in" | "out"): void => change(direction);
  contents.on("before-input-event", onKey);
  contents.on("zoom-changed", onWheelZoom);
  contents.on("did-finish-load", apply);
  const unsubscribe = store.onDidChange(apply);
  apply();
  return async () => {
    contents.removeListener("before-input-event", onKey);
    contents.removeListener("zoom-changed", onWheelZoom);
    contents.removeListener("did-finish-load", apply);
    await pending;
    unsubscribe();
  };
}
