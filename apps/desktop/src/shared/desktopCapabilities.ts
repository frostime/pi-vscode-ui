import type { ClientUiCapabilities } from "@frostime/pi-client/shared/model/clientUiCapabilities";

/** The main host and renderer consume this same static declaration. */
export const DESKTOP_CLIENT_UI_CAPABILITIES = {
  sessionEditorTabs: false, // Desktop has no editor-tab presentation.
  editorMentionSpecials: false, // There is no active IDE selection/current file.
  openReferencedLocation: true, // Code opens in VS Code; documents and directories use the system handler.
  exportDiagnostics: false, // Desktop diagnostics export is not implemented in this preview.
} satisfies ClientUiCapabilities;
