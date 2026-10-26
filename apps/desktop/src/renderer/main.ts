import "@frostime/pi-client/ui/styles";
import "./theme.css";

import { mount } from "svelte";
import { connectHostBridge, onHostMessage, postToHost } from "@frostime/pi-client/ui/bridge/hostBridge";
import { applyHostMessage } from "@frostime/pi-client/ui/bridge/applyHostMessage";
import DesktopApp from "./DesktopApp.svelte";
import { readDesktopTheme, type DesktopSettingsView } from "../shared/desktopSettings.js";
import { applyDesktopTheme } from "./theme.js";
import { applyDesktopUiTypography } from "./uiTypography.js";

connectHostBridge({
  postMessage: (message) => window.frostpiDesktop.postClientMessage(message),
  onMessage: (listener) => window.frostpiDesktop.onClientMessage(listener),
});
async function start(): Promise<void> {
  let initialSettings: DesktopSettingsView | null = null;
  try {
    initialSettings = await window.frostpiDesktop.settings({ type: "read" });
  } catch { /* DesktopApp shows the settings-service error without blocking the client. */ }
  applyDesktopTheme(readDesktopTheme(initialSettings?.values ?? {}));
  applyDesktopUiTypography(initialSettings?.values ?? {});
  mount(DesktopApp, { target: document.getElementById("app")!, props: { initialSettings } });
  onHostMessage(applyHostMessage);
  postToHost({ type: "ready" });
}

void start();
