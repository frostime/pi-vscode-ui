import "$ui/styles";

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
