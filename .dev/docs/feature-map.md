---
title: Feature → Code Map
description: Compact map from product features to owning modules, entry points, and nearest contracts.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-09-04
---

# Feature → Code Map

Use this map when the feature is known but its owner is not. Paths name owners and one or two useful entry points rather than every implementation file.

## Session lifecycle and persistence

- Owner: `apps/vscode/src/extension/sessions/`; start with `SessionRegistry.ts`, `SessionRuntime.ts`, and `SessionPersistence.ts`.
- Contract: `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`.

## Existing-session catalog and worktrees

- Owner: `apps/vscode/src/extension/sessions/catalog/` and `apps/vscode/src/extension/sessions/SessionWorkingDirectories.ts`.
- Contracts: `apps/vscode/src/extension/sessions/catalog/session-catalog.SPEC.md` and the lifecycle SPEC.

## Session tree navigation and private extension

- Owner: `apps/vscode/src/extension/sessions/tree/`; packaged adapter: `apps/vscode/pi-extensions/session-tree.ts`.
- Contract: `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`.

## Conversation projection

- Owner: `apps/vscode/src/extension/conversation/`; state inputs: `apps/vscode/src/extension/sessions/SessionEntryState.ts` and `apps/vscode/src/extension/sessions/SessionViewState.ts`.
- Contract: `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`.

## Pi RPC transport

- Owner: `packages/pi-rpc/src/`; start with `packages/pi-rpc/src/PiRpcConnection.ts`, `packages/pi-rpc/src/PiRpcApi.ts`, and `packages/pi-rpc/src/protocol/JsonlDecoder.ts`.
- Contracts: `packages/pi-rpc/SPEC.md` and `.dev/docs/protocol/pi-rpc-compatibility.md` for cross-module policy.

## Host–Webview bridge

- Owners: `apps/vscode/src/extension/webview-host/`, `apps/vscode/src/shared/bridge/`, and `apps/vscode/src/webview/bridge/`.
- Start with `SessionWebviewCoordinator.ts`, `WebviewConnection.ts`, `WebviewActionDispatcher.ts`, and `applyHostMessage.ts`; panel identity/lifecycle lives in `SessionPanelManager.ts`, transient handoff in `ComposerDraftCache.ts`, and synchronization rules in `apps/vscode/src/shared/bridge/webview-bridge.SPEC.md`.

## Composer, file mentions, and attachments

- Owners: `apps/vscode/src/webview/features/composer/`, `apps/vscode/src/extension/composer/`, and `apps/vscode/src/extension/attachments/`.
- Entry points/contracts: `apps/vscode/src/webview/features/composer/Composer.svelte`, `apps/vscode/src/extension/composer/mentions/WorkspaceFileSearch.ts`, `apps/vscode/src/webview/features/composer/composer.SPEC.md`, and `apps/vscode/src/extension/composer/mentions/file-mentions.SPEC.md`.

## Conversation rendering, Markdown, and scrolling

- Owner: `apps/vscode/src/webview/features/conversation/`; scrolling lives in `apps/vscode/src/webview/features/conversation/scrolling/`.
- Entry points/contracts: `apps/vscode/src/webview/features/conversation/ConversationView.svelte`, `apps/vscode/src/webview/features/conversation/markdown/renderMarkdown.ts` (`markdown-it`), and `apps/vscode/src/webview/features/conversation/markdown/markdown.SPEC.md`; cross-feature scroll ownership is in `.dev/docs/design/ui-spec.md`.

## Response annotation review

- Owner: `apps/vscode/src/webview/features/annotation-review/`; shell coordination is in `apps/vscode/src/webview/shell/SessionInteraction.svelte`.
- Entry points/contracts: `ResponseAnnotationWorkspace.svelte`, `annotationPrompt.ts`, and `annotation-review.SPEC.md`.

## Models and thinking level

- Owner: `apps/vscode/src/webview/features/models/`; start with `ModelPicker.svelte` and `thinkingLevels.ts`.
- Contracts: `apps/vscode/src/webview/features/models/thinking-levels.SPEC.md` and `apps/vscode/src/webview/features/models/model-picker.SPEC.md`.

## Extension UI and Question tool

- Owners: `apps/vscode/src/extension/extension-ui/`, `apps/vscode/src/extension/question-tool/`, `apps/vscode/src/shared/question-tool/`, the matching Webview features, and `apps/vscode/pi-extensions/question-tool.ts`.
- Entry points/contracts: `ExtensionUiCoordinator.ts`, `QuestionToolExtensionBridge.ts`, and `apps/vscode/src/extension/extension-ui/extension-ui.SPEC.md`.

## Network proxy and process environment

- Owner: `apps/vscode/src/extension/network/`; executable configuration starts in `apps/vscode/src/extension/configuration/configuredPiInvocation.ts`.
- Contracts: `apps/vscode/src/extension/network/proxy-environment.SPEC.md`, `packages/pi-rpc/SPEC.md`, and the Pi compatibility guide.

## Editor, file, and diff integration

- Owners: `apps/vscode/src/extension/composer/ComposerExternalEditor.ts`, `apps/vscode/src/extension/conversation/openReferencedLocation.ts`, and `apps/vscode/src/extension/file-changes/GitBaseContentProvider.ts`.
- Contracts: Composer and file-mention SPECs; bridge validation is owned by the bridge SPEC.

## Diagnostics, notifications, and status bar

- Owners: `apps/vscode/src/extension/diagnostics/`, `apps/vscode/src/extension/notifications/`, and `apps/vscode/src/extension/status-bar/`.
- Cross-module sensitivity boundary: `.dev/docs/architecture/overview.md`; lifecycle-trigger semantics remain in the lifecycle and extension UI SPECs.

## Build, testing, packaging, and release

- Owners: root `package.json`, package-local manifests, `scripts/`, `.github/workflows/`, and `apps/vscode/test/` / `packages/pi-rpc/test/`.
- Workflows: `.dev/docs/development.md`, `.dev/docs/testing.md`, and `.dev/docs/release.md`.
