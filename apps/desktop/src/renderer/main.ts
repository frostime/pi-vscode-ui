import "@vscode/codicons/dist/codicon.css";
import "@frostime/pi-client/ui/styles/reset.css";
import "@frostime/pi-client/ui/styles/vscode-theme.css";
import "@frostime/pi-client/ui/styles/tokens.css";
import "@frostime/pi-client/ui/styles/sessions.css";
import "@frostime/pi-client/ui/styles/composer.css";
import "@frostime/pi-client/ui/styles/pickers.css";
import "@frostime/pi-client/ui/styles/typography.css";
import "@frostime/pi-client/ui/styles/markdown.css";
import "@frostime/pi-client/ui/styles/motion.css";
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
