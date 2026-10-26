---
title: Feature → Code Map
description: Product features, owning code, and nearest contracts.
scope:
  - /apps/**
  - /packages/**
updated: 2026-10-24
---

# Feature → Code Map

Use this map to locate a feature's source and nearest contract. Paths are workspace-relative unless a section states otherwise. For questions about process placement, state authority or dependency direction, read [architecture overview](architecture/overview.md).

## Session lifecycle, persistence, and Projects

- Shared collection: `apps/pi-client/src/host/SessionRegistry.ts`; metadata: `apps/pi-client/src/host/sessions/SessionPersistence.ts`; single-session execution/state: `apps/pi-client/src/core/sessions/`.
- VS Code assembly: `apps/vscode/src/extension/activate.ts` and `clientHost.ts`.
- Desktop Project roots: `apps/desktop/src/main/desktopProjects.ts`; Project ownership/last Session/sidebar state: `apps/desktop/src/main/DesktopProjectNavigation.ts`; action adaptation: `apps/desktop/src/main/DesktopActionDispatcher.ts`; sidebar/drawer/resize: `apps/desktop/src/renderer/DesktopShell.svelte`. `apps/desktop/src/main/createDesktopApp.ts` assembles the shared Registry/client with `desktopHost.ts`. Versioned Project/client Memento data lives in `apps/desktop/src/main/storage/DesktopStateStore.ts`; both JSON stores use the bounded/atomic `apps/desktop/src/main/storage/jsonFile.ts` helper.
- Contracts: `apps/pi-client/SPEC.md`, `apps/pi-client/src/host/session-lifecycle.SPEC.md`, and `apps/desktop/SPEC.md`.

## Working directories, history catalog, and session tree

- Shared Git worktree discovery: `apps/pi-client/src/host/sessions/SessionWorkingDirectories.ts`; history scan/picker: `apps/pi-client/src/host/catalog/`.
- Tree interaction: `apps/pi-client/src/host/pickers/SessionTreePicker.ts`; tree projection/private bridge: `apps/pi-client/src/core/sessions/tree/`.
- Pi-side tree/Question artifacts: `apps/pi-client/pi-extensions/`; both products bundle the same sources into their distributions.
- Catalog contract: `apps/pi-client/src/host/catalog/session-catalog.SPEC.md`.

## Conversation projection and transport

- Projection: `apps/pi-client/src/core/conversation/ConversationProjection.ts`; persisted/live identity is owned with `SessionEntryState.ts` and `SessionViewState.ts`.
- Contract: `apps/pi-client/src/core/conversation/conversation-projection.SPEC.md`.
- Pi subprocess/framing/dialects: `packages/pi-rpc/src/`; start with `PiRpcConnection.ts` and `PiRpcApi.ts`. Contracts: `packages/pi-rpc/SPEC.md` and `.dev/docs/protocol/pi-rpc-compatibility.md`.

## Host interface and presentation bridge

- Finite injected VS Code-shaped services: `apps/pi-client/src/host/clientHost.ts`. Real implementation: `apps/vscode/src/extension/clientHost.ts`; Desktop translation: `apps/desktop/src/main/desktopHost.ts`. Static UI support is declared in `apps/pi-client/src/shared/model/clientUiCapabilities.ts` with Desktop's values in `apps/desktop/src/shared/desktopCapabilities.ts`.
- Shared authorization/dispatch/synchronization/drafts: `apps/pi-client/src/host/bridge/`; start with `WebviewConnection.ts`, `WebviewActionDispatcher.ts`, and `ComposerDraftCache.ts`.
- Shared browser bridge and presentation state: `apps/pi-client/src/ui/bridge/` and `state/`.
- VS Code sidebar/tab assembly: `apps/vscode/src/extension/webview-host/SessionWebviewCoordinator.ts` and `SessionPanelManager.ts`; native browser transport: `apps/vscode/src/webview/bridge/vscodeBridge.ts`.
- Desktop finite preload/IPC: `apps/desktop/src/preload.ts`, `apps/desktop/src/shared/desktopBridge.ts`, `apps/desktop/src/main/createDesktopApp.ts`.
- Contract: `apps/pi-client/src/shared/bridge/webview-bridge.SPEC.md`.

## Shared UI

Paths below are relative to `apps/pi-client/src/ui/` unless stated otherwise.

- Root/composition: `ClientApp.svelte`, `shell/SidebarShell.svelte`, `shell/SessionInteraction.svelte`; editor availability: `../shared/model/clientUiCapabilities.ts`.
- Session Header/New/Resume: `features/sessions/SessionHeader.svelte` and `SessionList.svelte`.
- Composer/mentions/attachments: `features/composer/Composer.svelte` and `composer.SPEC.md`; shared file search: `../host/file-search/`; VS Code editor capture: `apps/vscode/src/extension/composer/`.
- Conversation/scrolling: `features/conversation/ConversationView.svelte` and `scrolling/`; Markdown: `markdown/renderMarkdown.ts` and `markdown.SPEC.md`.
- Response annotation: `features/annotation-review/` and its SPEC; shell coordination: `shell/SessionInteraction.svelte`.
- Models/thinking: `features/models/ModelPicker.svelte`, `thinkingLevels.ts`, and adjacent SPECs.
- Extension/Question UI: `features/extension-ui/`, `features/question-tool/`; shared coordination: `../core/extension-ui/` and `../core/question-tool/`.
- Provider usage surface: `features/provider-usage/` and its SPEC; credential/query engine remains `packages/provider-usage/`. Safe reports travel through the common validated bridge.
- Styles/theme: `styles/`; preserve VS Code variables, FrostPi mappings and Codicons. Desktop palettes: `apps/desktop/src/renderer/theme.css`; application: `apps/desktop/src/renderer/theme.ts`; persisted choice: `desktop.theme` in the Desktop settings schema. Cross-feature requirements: `.dev/docs/design/ui-spec.md`.
- Desktop-only outer navigation/dialogs: `apps/desktop/src/renderer/DesktopApp.svelte` and `apps/desktop/src/renderer/DesktopShell.svelte`; they mount the same ClientApp, not a second chat implementation.

## Editor, configuration, network, and diagnostics

- VS Code file/selection/external Composer editor: `apps/vscode/src/extension/composer/`; file/diff navigation: `apps/vscode/src/extension/conversation/openReferencedLocation.ts` and `apps/vscode/src/extension/file-changes/`. Desktop file opening: `apps/desktop/src/main/openReferencedLocation.ts`; pure reference parsing/whitelist: `apps/pi-client/src/shared/files/fileReferences.ts`.
- Shared setting parsing: `apps/pi-client/src/host/readConfiguration.ts`; Runtime invocation/compatibility: `apps/pi-client/src/core/configuration/`; process proxy calculation: `apps/pi-client/src/core/network/`.
- Desktop settings storage/import/actions: `apps/desktop/src/main/settings/`; original-key schema additions and finite operations: `apps/desktop/src/shared/desktopSettings.ts`; settings modal/draft coordination: `apps/desktop/src/renderer/SettingsPanel.svelte`; grouped labels: `settingsPresentation.ts`; schema-based draft conversion: `settingsForm.ts`; field controls/key disclosure: `SettingRow.svelte` in the same renderer directory. Contract: `apps/desktop/SPEC.md`.
- Native proxy configuration/secrets: `apps/vscode/src/extension/network/`. Contract: `proxy-environment.SPEC.md` there; proxy changes require process restart.
- Pi settings: `apps/pi-client/src/core/_shared/pi-settings/`; cache-miss projection: `apps/pi-client/src/core/conversation/cacheMissDetection.ts`.
- VS Code diagnostics/status/notifications: `apps/vscode/src/extension/diagnostics/`, `status-bar/`, `notifications/`.

## Verification and packaging

- Desktop distribution staging/version/target: `apps/desktop/scripts/packaging.mjs` and `package-app.mjs`; actual extracted-executable verification: `apps/desktop/scripts/verify-package.mjs`.
- Package-local scripts and tests: `apps/pi-client/`, `apps/vscode/`, `apps/desktop/`, `packages/pi-rpc/`, `packages/provider-usage/`.
- Workflows: `development.md`, `testing.md`, `release.md`. Root scripts orchestrate packages; plugin-local build must not require Desktop.
