# Desktop development host

This product adapts the VS Code-first [shared client](../pi-client/SPEC.md). It must use the same ClientApp, Registry, dispatch, projection and Pi RPC implementation; Project navigation is presentation/host policy, not another session manager.

## Project and session context

Registered Projects are validated, canonical local directories. Their roots remain registered across foreground selection changes. The selected Project anchors New/Resume only; existing Pi identities/cwds do not change. The default navigation shows all open Pi, and shared UI state remains keyed by live session identity, not the currently selected Project.

The current entry is explicitly a development preview: Projects, overrides and client metadata are memory-only, and the launcher uses an isolated temporary Electron profile. Closing the preview disposes its Pi children. This is not a persistent settings/session store or a final app-reopen/background-service contract. Pi's own JSONL ownership is unchanged.

Configuration overrides use existing VS Code-style names and shared fallback parsing. `frostpi.network.proxy.mode = "vscode"` is rejected, not reinterpreted. Preview settings updates and unavailable editor integrations fail explicitly; the UI hides editor-tab/selection features and omits `/editor`.

## Renderer and native authority

The renderer has context isolation and sandboxing with Node integration disabled. Its [preload API](src/shared/desktopBridge.ts) exposes finite client/project/dialog operations, never Node or raw IPC. Main validates sender/main-frame identity before accepting messages; common client messages additionally pass shared version/schema/session-target authorization.

Adding a Project requires a main-process native directory choice (or an explicit process-start directory argument). Renderer selection can reference only a registered identity. It cannot submit an arbitrary process cwd or configuration file path. The same rule applies while another Pi runs in the background.

Desktop pick/input responses correlate to one Host-owned request; unknown/stale ids have no effect. Only listed non-separator choices are selectable. QuickPick labels retain VS Code's `$(icon~modifier)` syntax, rendered as Codicons and text nodes rather than HTML; filtering excludes icon names and respects the caller's description/detail matching options. Separator labels remain plain text. Window disposal cancels pending interactions rather than approving them. Main owns native confirmation/file/clipboard/external-link operations; shared external links retain the http(s) check.

The renderer consumes the common client style entry and a Desktop-supplied VS Code variable palette. Packaged entry scripts and their `vendor/` resources share the VS Code Webview's entry-relative URL layout. Theme import, VS Code Workbench internals and TextMate grammar execution are not implied by that palette.

## Evidence

Unit tests use temporary roots and mocked native boundaries. `test:smoke` launches actual Electron with controlled, isolated Pi children and reports explicit artifact success; a clean Electron exit alone cannot pass. Real model/history/input acceptance remains separate from this controlled test.
