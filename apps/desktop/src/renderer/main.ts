import "@frostime/pi-client/ui/styles";
import "./theme.css";

import { mount } from "svelte";
import { connectHostBridge, onHostMessage, postToHost } from "@frostime/pi-client/ui/bridge/hostBridge";
import { applyHostMessage } from "@frostime/pi-client/ui/bridge/applyHostMessage";
import DesktopApp from "./DesktopApp.svelte";

connectHostBridge({
  postMessage: (message) => window.frostpiDesktop.postClientMessage(message),
  onMessage: (listener) => window.frostpiDesktop.onClientMessage(listener),
});
mount(DesktopApp, { target: document.getElementById("app")! });
onHostMessage(applyHostMessage);
postToHost({ type: "ready" });
