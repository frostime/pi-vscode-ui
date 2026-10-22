# Desktop development host

This product adapts the VS Code-first [shared client](../pi-client/SPEC.md). It must use the same ClientApp, Registry, dispatch, projection and Pi RPC implementation; Project navigation is presentation/host policy, not another session manager.

## Project and session context

Registered Projects are validated, canonical local directories. Their roots remain registered across foreground selection changes. The selected Project anchors New/Resume only; existing Pi identities/cwds do not change. The default navigation shows all open Pi, and shared UI state remains keyed by live session identity, not the currently selected Project.

The current entry is a development preview with persistent settings but memory-only Projects and client session metadata. Closing the preview disposes its Pi children. Persistent settings do not imply session/draft recovery or a final app-reopen/background-service contract. Pi's own JSONL ownership is unchanged. Unavailable editor integrations fail explicitly; the UI hides editor-tab/selection features and omits `/editor`.

## Settings and initial import

`settings.json` lives under the system application-data directory's `FrostPi` folder. The normal launcher keeps it across exits; `FROSTPI_DESKTOP_USER_DATA` can redirect the entire profile for isolated development. Keys remain flat, original VS Code/FrostPi dot names. Real Desktop-only settings belong under `desktop.*`; Projects/window/session metadata are not settings. No Desktop-only setting is invented merely to populate that namespace.

FrostPi setting definitions come from the manifest-generated shared schema, not a second handwritten table. The [Desktop definitions](src/shared/desktopSettings.ts) add only the consumed VS Code settings: four `chat` typography keys, `editor.fontFamily`, `files.exclude`, and `search.exclude`. Shared Chat typography defaults remain single-source. Exclusion maps merge their built-in defaults with explicit entries, including `false` overrides. The Desktop maps `editor.fontFamily` to its Webview-equivalent CSS variable; it must not silently substitute `editor.fontSize` for the existing Chat code-block size semantics.

A missing Desktop settings file opens first-run setup. Import reads only the standard VS Code default-user settings file, never a Project, Remote or selected Profile. It accepts JSONC and returns an editable whitelist preview; only Save writes Desktop settings. Use defaults initializes an empty override file. Subsequent starts read Desktop settings without reimport or synchronization. Source settings and credentials are never modified. Proxy mode `vscode` converts explicitly in the preview to `custom` with a valid credential-free `http.proxy`; unresolved conversion blocks Save rather than silently changing meaning. Unsupported native notifications are skipped with a notice. Proxy credentials cannot be stored in this file.

The [store](src/main/settings/DesktopSettingsStore.ts) publishes changes after a successful atomic write, serializes writes, and leaves damaged/unreadable files untouched. Repair through the system editor and Reload; failed loads cannot be reset/imported/saved over automatically. Reset deletes an override rather than pinning the current default. Main owns the settings path, import path and native editor action; the renderer receives only finite sender/main-frame-validated operations. Saving refreshes typography and application configuration, never restarts Pi. Process settings apply on new/explicitly restarted children.

## Renderer and native authority

The renderer has context isolation and sandboxing with Node integration disabled. Its [preload API](src/shared/desktopBridge.ts) exposes finite client/project/dialog operations, never Node or raw IPC. Main validates sender/main-frame identity before accepting messages; common client messages additionally pass shared version/schema/session-target authorization.

Adding a Project requires a main-process native directory choice (or an explicit process-start directory argument). Renderer selection can reference only a registered identity. It cannot submit an arbitrary process cwd or configuration file path. The same rule applies while another Pi runs in the background.

Desktop pick/input responses correlate to one Host-owned request; unknown/stale ids have no effect. Only listed non-separator choices are selectable. QuickPick labels retain VS Code's `$(icon~modifier)` syntax, rendered as Codicons and text nodes rather than HTML; filtering excludes icon names and respects the caller's description/detail matching options. Separator labels remain plain text. Window disposal cancels pending interactions rather than approving them. Main owns native confirmation/file/clipboard/external-link operations; shared external links retain the http(s) check.

The renderer consumes the common client style entry and a Desktop-supplied VS Code variable palette. Packaged entry scripts and their `vendor/` resources share the VS Code Webview's entry-relative URL layout. Theme import, VS Code Workbench internals and TextMate grammar execution are not implied by that palette.

## Evidence

Unit tests use temporary roots and mocked native boundaries. `test:smoke` launches actual Electron with controlled, isolated Pi children and reports explicit artifact success; a clean Electron exit alone cannot pass. Real model/history/input acceptance remains separate from this controlled test.
