/**
 * Host-dependent UI affordances a product must explicitly declare when mounting
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
  /** Host can open a conversation's local file reference in its native editor/viewer. */
  openReferencedLocation: boolean;
  /** Host provides the diagnostics export action. */
  exportDiagnostics: boolean;
}

/** VS Code provides every declared UI capability; shared defaults preserve plugin behavior. */
export const VSCODE_CLIENT_UI_CAPABILITIES: ClientUiCapabilities = {
  sessionEditorTabs: true,
  editorMentionSpecials: true,
  openReferencedLocation: true,
  exportDiagnostics: true,
};
