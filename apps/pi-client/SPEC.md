# FrostPi shared client contract

## Ownership and environment boundaries

This is FrostPi's shared application implementation, not a generic host SDK. VS Code remains the reference environment and behavior. The VS Code product binds real services thinly; Desktop adapts the finite [ClientHost](src/host/clientHost.ts) surface. Unsupported optional operations fail explicitly. Client runtime code must not import `vscode`, Electron, or a product entry; adding a dependency requires extending the concentrated interface rather than bypassing it.

Separate entries preserve execution environments: `core` owns one-session process policy/projection, `host` owns common Registry/bridge/interaction flows, `shared` contains serializable definitions and pure helpers, and `ui` contains browser/Svelte implementation. No combined browser/Node root barrel. Shared definitions have no Node/core/host runtime dependency; UI has no backend/Node dependency. Both products consume the same source, not copies. Default backend exports use built JS/declarations; browser consumers compile the exported Svelte/CSS source. Type/bundler/test mappings must not select stale parallel implementations.

One `SessionRuntime` owns one Pi child. Its identity, cwd and configuration scope never follow the foreground Project. The shared Registry owns collection/lifecycle rules; injected workspace services supply stable allowed roots and an explicit New/Resume anchor. Project navigation does not remove sessions, stop children or release drafts. Preserve the [VS Code lifecycle contract](../vscode/src/extension/sessions/session-lifecycle.SPEC.md), including Provisional/ephemeral, Fork recovery, separate startup/history queues and concurrent agent execution.

## Configuration and process lifecycle

[Shared configuration parsing](src/host/readConfiguration.ts) retains VS Code key/default semantics. Hosts provide configuration reads and storage, not a second manually maintained parser/default table. Native setting writes and VS Code proxy reading remain adapter responsibilities. Desktop may reject environment-specific settings explicitly; it must not silently reinterpret `vscode` proxy mode.

Runtime receives client version, a live host-proxy reader, read-only credentials, logging and event/editor-text hooks. Configuration/proxy refresh and launch read current values, not construction-time snapshots. Credentials are read at launch only. Changed executable/proxy/credentials/Question configuration never silently interrupts a running turn; changes apply on explicit start/restart.

Private tree/Question artifact paths are explicit product inputs. Both products bundle the same sources under `pi-extensions`; bridges own tokens, temporary files, validation and cancellation. Host Pi arguments remain intact; custom launch tokens are appended last, reused on restart, never persisted/logged. No generic extension manager is implied.

Process stop cancels pending extension UI, finalizes unresolved tools, clears transient queues/assembly, and retains retryable metadata. Abort stops a turn, not its child. Presentation disposal alone must not stop Runtime. Missing/incompatible history fails visibly rather than creating an empty replacement under the same identity.

`agent_end` closes an attempt, `agent_settled` closes a user turn, and prompt acknowledgement is not completion. Ready before resumed-history completion does not authorize submission. Persisted entry authority and buffered events follow [conversation projection](src/core/conversation/conversation-projection.SPEC.md).

## Presentation and integration

One ClientApp/store/transport serves one browser document. A Desktop sidebar may navigate all live sessions but must not mount an independent shared chat root per Project. Existing Header/New/Resume, conversation, Composer and interaction behavior are shared. Product-local command adapters and declared editor capabilities supply environment differences; there are no host-name conditionals in shared components.

Preserve existing CSS/class/Codicons, `--vscode-*` variables and `--frost-*` mappings. Browser entries import the common `ui/styles` entry rather than maintaining per-product stylesheet lists; product-specific theme variables remain local. Both hosts consume the shared Chat typography reader instead of defining their own font defaults. Hosts supply their Webview-equivalent theme environment; this does not promise VS Code internal Workbench or complete theme grammar compatibility. [UI constraints](../../.dev/docs/design/ui-spec.md) and [bridge synchronization/authorization](src/shared/bridge/webview-bridge.SPEC.md) remain authoritative.

Blocking inputs stay bound to their Runtime/request until response, Pi timeout or cancellation. No automatic confirmation or cross-session answer. Pi owns credentials, JSONL and file writes; Host metadata/drafts cannot become another conversation database. See [extension UI](src/core/extension-ui/extension-ui.SPEC.md) and [Pi settings](src/core/_shared/pi-settings/pi-settings.SPEC.md).

## Verification

Shared backend tests run with injected fake host services and isolated Pi settings; no VS Code mocks or Electron GUI are needed. Core/shared/UI have separate type checks and import restrictions. Both product builds must consume this implementation; VSIX/Electron artifacts must not depend on workspace source paths at runtime. Controlled child/GUI tests do not substitute for real-Pi acceptance.
