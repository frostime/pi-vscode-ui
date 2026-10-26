import { writable } from "svelte/store";

import { VSCODE_CLIENT_UI_CAPABILITIES, type ClientUiCapabilities } from "$shared/model/clientUiCapabilities";

/**
 * Per-document capability state for the document's single ClientApp root; entry
 * code and non-root components must not write it. ClientApp sets it
 * synchronously during mount, so the VS Code default below only covers the
 * window before the first root mounts — entry wiring subscribes to host
 * messages only after mount, so no message is applied under the default.
 */
export const clientCapabilities = writable<ClientUiCapabilities>(VSCODE_CLIENT_UI_CAPABILITIES);
