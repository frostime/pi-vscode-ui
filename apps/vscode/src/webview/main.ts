import "@vscode/codicons/dist/codicon.css";
import "$ui/styles/reset.css";
import "$ui/styles/vscode-theme.css";
import "$ui/styles/tokens.css";
import "$ui/styles/sessions.css";
import "$ui/styles/composer.css";
import "$ui/styles/pickers.css";
import "$ui/styles/typography.css";
import "$ui/styles/markdown.css";
import "$ui/styles/motion.css";

import { mount } from "svelte";

import ClientApp from "$ui/ClientApp.svelte";
import { applyHostMessage } from "$ui/bridge/applyHostMessage";
import { connectHostBridge, onHostMessage, postToHost } from "$ui/bridge/hostBridge";
import { createVsCodeTransport } from "./bridge/vscodeBridge";
import { createVsCodeComposerCommands } from "./shell/vscodeComposerCommands";

const disconnect = connectHostBridge(createVsCodeTransport());
const app = mount(ClientApp, {
  target: document.getElementById("app")!,
  props: { localComposerCommands: createVsCodeComposerCommands() },
});
const unsubscribe = onHostMessage(applyHostMessage);
postToHost({ type: "ready" });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe();
    disconnect();
  });
}

export default app;
