---
title: Feature → Code Map
description: Compact index from feature domain to primary implementation files. Start here when you know what to change but not where.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-07-27
---

# Feature → Code Map

Path aliases used throughout:
`{{ext}}` = `apps/vscode/src/extension/`
`{{web}}` = `apps/vscode/src/webview/features/`
`{{wv}}` = `apps/vscode/src/webview/` (only for files outside `features/`)
`{{shared}}` = `apps/vscode/src/shared/`
`{{rpc}}` = `packages/pi-rpc/src/`

SPEC files are colocated with their code (e.g. `{{ext}}/sessions/session-lifecycle.SPEC.md`).

---

## Session Lifecycle

Entry point for create, start, stop, persist, discover, fork, tree-nav.

| File | Role |
|------|------|
| `{{ext}}/sessions/SessionRegistry` | owns session collection; create/close/activate/persist; fork & branch orchestration; serialized start & history queues |
| `{{ext}}/sessions/SessionRuntime` | one Pi subprocess per session; coordinates entry, conversation, and scalar state; prompt/event/RPC lifecycle |
| `{{ext}}/sessions/SessionWorkingDirectories` | `git worktree list` → valid working directories |
| `{{ext}}/sessions/catalog/SessionCatalog` | scan disk for Pi `.jsonl` sessions; read metadata from file headers |
| `{{ext}}/sessions/catalog/SessionCatalogPicker` | VS Code progress, QuickPick, and open-file UI for resume |
| `{{ext}}/sessions/SessionPersistence` | `vscode.WorkspaceState` adapter for session metadata |
| `{{ext}}/sessions/normalizePiSlashPrompt` | trim & normalize `/compact`, `/resume`, whitespace in slash commands |
| `{{ext}}/sessions/tree/SessionTreeExtensionBridge` | injects bundled `session-tree.js` extension into Pi; `navigate()` wraps Pi's tree mutation |
| `{{ext}}/sessions/tree/sessionTreeProjection` | pure functions: `projectActiveBranchEdges()`, editable targets, navigation validation, and branch-end choices |
| `{{ext}}/sessions/tree/SessionTreePicker` | VS Code QuickPick/InputBox for branch summary, branch-end, draft-replacement prompts |

SPEC: `{{ext}}/sessions/session-lifecycle.SPEC`, `{{ext}}/sessions/catalog/session-catalog.SPEC`

---

## Conversation Projection

Builds the complete active-path transcript from Pi entries and reconciles optimistic/live RPC events into the same ordered model.

| File | Role |
|------|------|
| `{{ext}}/sessions/SessionEntryState` | owns entry cursor/leaf, validates incremental continuation, retains content-free tree index, selects active path |
| `{{ext}}/conversation/ConversationProjection` | owns ordered conversation items, visual turns, live-to-persisted identity, tools, follow-ups, and boundaries |
| `{{ext}}/sessions/SessionViewState` | owns session-level scalar state and composes `SessionViewModel` with the conversation snapshot |
| `{{ext}}/conversation/messageAssembler` | deterministic message content, image-block, tool, and text conversion |

Shared model types: `{{shared}}/model/sessionViewModel.ts`, `{{shared}}/model/conversationModel.ts`, `{{shared}}/model/toolCallModel.ts`

SPEC: `{{ext}}/conversation/conversation-projection.SPEC`

---

## Pi RPC Transport

`@frostime/pi-rpc` owns child process + JSONL framing only. Product policy stays in the extension.

| File | Role |
|------|------|
| `{{rpc}}/PiRpcConnection` | spawn `pi --mode rpc`; stdin write; stdout JSONL decode; request↔response correlation; timeout; SIGTERM→SIGKILL stop |
| `{{rpc}}/PiRpcApi` | typed wrappers: `prompt()`, `getState()`, `getMessages()`, `getEntries()`, `fork()`, `setModel()`, `compact()`, etc. |
| `{{rpc}}/protocol/JsonlDecoder` | LF-delimited JSON stream parser (not `readline`) |
| `{{rpc}}/protocol/rpcTypes` | wire types: `RpcCommand`, `RpcEvent`, `RpcResponse`, `RpcSessionState` |
| `{{rpc}}/protocol/protocolErrors` | `PiRpcCommandError`, `PiRpcProcessError`, `PiRpcProtocolError` |
| `{{ext}}/configuration/configuredPiInvocation` | converts the configured executable path into command/arguments; complete PATH resolution remains in `packages/pi-rpc/src/process/resolvePiExecutable.ts` |
| `{{ext}}/network/proxyConfiguration` | proxy configuration types and `DEFAULT_NO_PROXY` |
| `{{ext}}/network/buildPiProcessEnvironment` | resolve proxy env vars for Pi child process |
| `{{ext}}/network/configureProxy` | guided proxy and credential configuration UI |
| `{{ext}}/network/ProxySecretStore` | `vscode.SecretStorage` wrapper for proxy credentials |

SPEC: `{{rpc}}/SPEC` (in `packages/pi-rpc/`), `{{ext}}/network/proxy-environment.SPEC`

---

## Webview Bridge

Host-authoritative; snapshot on session switch, delta on same-session update. All messages schema-validated.

| File | Role |
|------|------|
| `{{ext}}/webview-host/WebviewBridge` | host side: receives + validates webview messages; dispatches to `SessionRegistry`; posts snapshot/workspaceDelta |
| `{{ext}}/webview-host/PiViewProvider` | VS Code `WebviewViewProvider`; HTML generation; attach/detach bridge |
| `{{shared}}/bridge/hostToWebview` | `HostToWebviewPayload` union + `WorkspaceDeltaView`, `CollectionDelta` types |
| `{{shared}}/bridge/webviewToHost` | Zod schema for all webview→host messages |
| `{{shared}}/bridge/collectionDelta` | diff helper: upsert/replace delta between ordered id lists |
| `{{wv}}/bridge/applyHostMessage` | webview side: receives host messages, updates Svelte stores |
| `{{wv}}/bridge/vscodeBridge` | `postToHost()` wrapper |
| `{{wv}}/state/sessionViewStore.svelte` | `workspaceStore` (Svelte writable), toast, composerFocusTick |
| `{{wv}}/features/composer/composerDraftStore.svelte` | per-session draft `{ text, images }`; `getDraft()`, `setDraft()`, `clearDraft()` |

SPEC: `{{shared}}/bridge/webview-bridge.SPEC`

---

## Composer (Prompt Input)

| File | Role |
|------|------|
| `{{web}}/composer/Composer.svelte` | shell: draft state, submit, image paste, expand/collapse; `/resume` and `/editor` intercept |
| `{{web}}/composer/PromptEditor.svelte` | CodeMirror 6 instance; keybindings; history; paste handling |
| `{{web}}/composer/promptEditing` | editing operations, cursor management |
| `{{web}}/composer/promptSyntax` | syntax highlighting for prompt |
| `{{web}}/composer/workspaceMentionCompletion` | CodeMirror `@` completion source |
| `{{web}}/composer/fileSuggestionClient` | debounced `searchWorkspaceFiles` requests |
| `{{web}}/composer/composerSeedClient` | applies `ComposerSeedView` (from fork/tree-nav) into draft |
| `{{web}}/composer/frostPiCommands` | merges FrostPi-local commands into Pi's command list |
| `{{ext}}/composer/mentions/WorkspaceFileSearch` | fd-based file search with exclude rules, ignore files, symlinks |
| `{{ext}}/composer/mentions/workspaceFileSearchContext` | derives VS Code exclude rules and active-session path boosts |
| `{{ext}}/composer/ComposerExternalEditor` | `/editor`: temp .md in VS Code, reads back on tab close |
| `{{ext}}/composer/mentions/captureActiveFile` | captures active editor path/line for `@file` context |
| `{{ext}}/composer/mentions/captureSelection` | captures editor selection for `@selection` mention |
| `{{ext}}/composer/mentions/editorMentionSpecials` | special mention targets: `selection`, `file` |
| `{{ext}}/composer/mentions/formatFileMention` | formats path → `@path:L` mention string |
| `{{ext}}/attachments/normalizeImageAttachment` | normalizes pasted/dropped images (dimensions, format, size) |

SPEC: `{{web}}/composer/composer.SPEC`, `{{ext}}/composer/mentions/file-mentions.SPEC`

---

## Conversation Display (Webview)

| File | Role |
|------|------|
| `{{web}}/conversation/ConversationView.svelte` | renders Host-ordered top-level conversation items from `workspaceStore` |
| `{{web}}/conversation/AgentTurn.svelte` | renders ordered turn items and collapses agent activities without moving fixed boundaries |
| `{{web}}/conversation/UserMessage.svelte` | user message blocks (text + images) |
| `{{web}}/conversation/ThinkingActivity.svelte` | reasoning/thinking block |
| `{{web}}/conversation/ToolActivity.svelte` | tool call card (bash, read, write, etc.) |
| `{{web}}/conversation/ResponseActivity.svelte` | final text/image response |
| `{{web}}/conversation/MarkdownContent.svelte` | markdown → HTML entry point |
| `{{web}}/conversation/markdown/renderMarkdown` | markdown→HTML via marked; code highlight, file refs, mermaid |
| `{{web}}/conversation/markdown/parseMessageBlocks` | block parser: code fences, mermaid detection |
| `{{web}}/conversation/markdown/MarkdownHtml.svelte` | rendered HTML with sanitization |
| `{{web}}/conversation/markdown/fileReferences` | clickable file references → `openFile` message |
| `{{web}}/conversation/markdown/MermaidBlock.svelte` | Mermaid diagram renderer |
| `{{web}}/conversation/BranchPointControl.svelte` | session-tree branch point button |
| `{{web}}/conversation/BranchSummaryBlock.svelte` | branch summary annotation card |
| `{{web}}/conversation/CompactionBlock.svelte` | context compaction summary |
| `{{web}}/conversation/SessionNotice.svelte` | non-turn notices (errors, info banners) |
| `{{web}}/conversation/ImageGallery.svelte` | image grid in messages |
| `{{web}}/conversation/collapseTurnTrace` | collapse policy for completed turns |
| `{{web}}/conversation/forkMessageClient` | fork request → result correlation |
| `{{web}}/conversation/copyMessageClient` | copy message text via host clipboard |
| `{{ext}}/conversation/openReferencedLocation` | jump to file:line when clicking file refs in conversation |

SPEC: `{{web}}/conversation/markdown/markdown.SPEC`

---

## Model & Thinking Level

| File | Role |
|------|------|
| `{{web}}/models/ModelPicker.svelte` | model dropdown; grouped by provider |
| `{{web}}/models/ProviderGroup.svelte` | single provider group in model list |
| `{{web}}/models/ThinkingLevelPicker.svelte` | thinking level dropdown |
| `{{web}}/models/thinkingLevels` | level definitions & compatibility |

SPEC: `{{web}}/models/thinking-levels.SPEC`

---

## Extension UI

Pi sends `extension_ui_request` events → `ExtensionUiCoordinator` handles dialogs and fire-and-forget decorations.

| File | Role |
|------|------|
| `{{ext}}/extension-ui/ExtensionUiCoordinator` | receives Pi extension UI events; owns pending dialogs, statuses, widgets; `handle()`, `respond()`, `cancelAll()` |
| `{{ext}}/extension-ui/sanitizeExtensionUiText` | strips control characters |
| `{{web}}/extension-ui/ExtensionUiHost.svelte` | renders pending dialogs + status widgets |
| `{{web}}/extension-ui/ExtensionUiRequestCard.svelte` | single standard dialog card (confirm/select/input/editor) |
| `{{ext}}/question-tool/QuestionToolExtensionBridge` | authenticates private Question markers; reads bounded request files; serializes responses |
| `{{shared}}/question-tool/questionToolProtocol` | dependency-free private marker, request, response, and answer-validation contract |
| `apps/vscode/pi-extensions/question-tool.ts` | bundled Pi `question` tool; request-file publication plus blocking `ctx.ui.input()` |
| `{{web}}/question-tool/QuestionToolHost.svelte` | bounded/collapsible panel and multiple-request switching |
| `{{web}}/question-tool/QuestionForm.svelte` | explicit per-question answers, note, Cancel, and Submit |
| `{{web}}/question-tool/questionDraft` | pure draft state and complete-submission rules |

SPEC: `{{ext}}/extension-ui/extension-ui.SPEC`

---

## Configuration

| File | Role |
|------|------|
| `{{ext}}/configuration/readConfiguration` | reads `frostpi.*` settings → `FrostPiConfiguration` |
| `{{ext}}/configuration/configurationTypes` | `FrostPiConfiguration` type |
| `{{ext}}/configuration/configurePiExecutable` | shared VS Code input UI for the Pi executable setting |
| `{{ext}}/configuration/readChatTypography` | reads VS Code `chat.fontFamily`/`chat.fontSize` |
| `{{ext}}/configuration/workspaceScope` | cwd → VS Code configuration scope URI |

---

## Commands & Activation

| File | Role |
|------|------|
| `{{ext}}/activate` | extension entry point: creates `SessionRegistry`, `WebviewBridge`, `PiViewProvider`; registers commands & config listeners |
| `{{ext}}/commands/registerCommands` | registers `frostpi.*` commands and delegates feature-specific UI/behavior to owning modules |

---

## Diagnostics

| File | Role |
|------|------|
| `{{ext}}/diagnostics/DiagnosticLogger` | structured logger; `redactDiagnosticText()` |
| `{{ext}}/diagnostics/exportDiagnostics` | write diagnostics to temp file, open in editor |
| `{{rpc}}/process/processDiagnostics` | `BoundedTextBuffer` for Pi stderr (64KB ring) |

---

## File Changes (Diff)

| File | Role |
|------|------|
| `{{ext}}/file-changes/GitBaseContentProvider` | `frostpi-git-base://` URI scheme; `git show HEAD:path` → diff against working tree |

---

## Styles

| File | Covers |
|------|--------|
| `{{wv}}/styles/tokens.css` | CSS custom properties / design tokens |
| `{{wv}}/styles/composer.css` | composer, prompt editor, toolbar, attachments |
| `{{wv}}/styles/sessions.css` | session list, header layout |
| `{{wv}}/styles/markdown.css` | rendered markdown typography, code blocks |
| `{{wv}}/styles/pickers.css` | picker dropdowns, model list |
| `{{wv}}/styles/vscode-theme.css` | VS Code theme variable bridge |
| `{{wv}}/styles/motion.css` | animation keyframes |
| `{{wv}}/styles/reset.css` | CSS reset |
| `{{wv}}/styles/typography.css` | base typography |

---

## Webview Shell & State

| File | Role |
|------|------|
| `{{wv}}/App.svelte` | root; routes to OnboardingView or AppShell |
| `{{wv}}/shell/AppShell.svelte` | main layout: header + metrics + conversation + composer + extension widgets |
| `{{wv}}/shell/SessionMetrics.svelte` | context usage stats bar |
| `{{wv}}/shell/ExtensionWidgets.svelte` | extension widget decorations |
| `{{web}}/onboarding/OnboardingView.svelte` | shown when no workspace or no active session |
| `{{web}}/sessions/SessionHeader.svelte` | session title, menu (rename, restart, diagnostics, etc.) |
| `{{web}}/sessions/SessionList.svelte` | session list sidebar |
| `{{web}}/usage/ContextUsagePopover.svelte` | token/context usage details |
| `{{web}}/scrolling/scrollFollowState` | auto-scroll state machine |
| `{{web}}/scrolling/NewUpdatesButton.svelte` | "new content below" indicator |

SPEC: `{{web}}/scrolling/scroll-follow.SPEC`
