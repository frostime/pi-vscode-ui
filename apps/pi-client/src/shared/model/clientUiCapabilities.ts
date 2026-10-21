/**
 * Editor-coupled UI affordances a host must explicitly declare when mounting
 * `ClientApp`. The shared UI hides unsupported features; it never stubs them.
 *
 * `/editor` and `/resume` composer commands are not declared here: they are
 * host-injected through the `localComposerCommands` prop, so a host without
 * editor integration simply supplies its own command set without them.
 */
export interface ClientUiCapabilities {
  /** Host can detach a session into its own editor tab (`openSessionPanel` / `revealSessionPanel`). */
  sessionEditorTabs: boolean;
  /** Host captures the active editor selection / current file and offers them as @-mention specials. */
  editorMentionSpecials: boolean;
}

/** VS Code provides every editor-coupled capability; shared defaults preserve plugin behavior. */
export const VSCODE_CLIENT_UI_CAPABILITIES: ClientUiCapabilities = {
  sessionEditorTabs: true,
  editorMentionSpecials: true,
};
