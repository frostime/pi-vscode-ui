---
title: FrostPi Private Question Tool — Implementation Plan
description: Ordered implementation and file-level change-shape preview for the bundled FrostPi question tool.
updated: 2026-07-25
---

# FrostPi Private Question Tool — Implementation Plan

Design authority: [`DEV_SPEC.md`](DEV_SPEC.md).

## Complexity Budget

The implementation must reuse Pi's standard Extension UI response lifecycle and FrostPi's existing session projection/bridge. The intended shape is one new Pi extension, one feature-specific Extension Host bridge, one shared private-protocol module, and one Webview feature directory.

Explicit cuts:

- no Pi upstream change;
- no new `@frostime/pi-rpc` command or event type;
- no file watcher or polling loop;
- no temporary response file;
- no second pending-response coordinator beside `ExtensionUiCoordinator`;
- no generic arbitrary-form renderer;
- no draft persistence outside Webview memory;
- no feature-only rules added to global CSS files;
- no Webview settings screen when VS Code Settings is sufficient.

If implementation evidence requires violating one of these cuts, stop and reassess the design before expanding scope.

# Part I | Execution Plan

## Phase 1: Private protocol and bundled Pi extension

- [ ] Define the versioned private marker, request-file schema, projected Question request, submission schema, and bounded validation in one shared pure protocol module.
- [ ] Implement the bundled Pi extension with the established `question` tool parameter/result contract.
- [ ] On execution, normalize questions, atomically publish an authenticated request file, call abort-aware `ctx.ui.input()`, validate the returned submission, return the normal tool result, and remove the request file in `finally`.
- [ ] Keep the tool callable only through normal Pi tool registration; do not add a slash command.
- [ ] Add the bundled extension as a separate esbuild entry.

**Agent Check**:

- Protocol tests cover marker round-trip, malformed identity, schema limits, submission completeness, and response decoding.
- A focused extension test or harness verifies publish-before-notify ordering, submit, cancel, abort, and request-file cleanup.
- The bundled extension builds without importing VS Code or Webview code.

## Phase 2: Extension Host bridge and Extension UI lifecycle

- [ ] Add a per-`SessionRuntime` Question bridge that owns the random token, temporary directory, bundled artifact path, launch arguments, and environment variables.
- [ ] Recognize authenticated FrostPi Question input markers before generic `input` handling.
- [ ] Read the request by derived identifier only, enforce directory containment and size/schema limits, then hand the typed pending request to `ExtensionUiCoordinator`.
- [ ] Extend `ExtensionUiCoordinator` with a narrow way to register the resolved Question dialog while preserving its existing exactly-once response, timeout, and `cancelAll()` ownership.
- [ ] Serialize a structured Webview submission into the standard Pi `{ value: string }` response; use `{ cancelled: true }` for cancellation.
- [ ] Prepare and dispose Question bridge resources with the owning Pi process. Runtime shutdown remains responsible for cancelling dialogs before process termination.
- [ ] Preserve multiple pending requests by request id; do not introduce a singleton current request.

**Agent Check**:

- Bridge tests reject bad markers, tokens, ids, traversal attempts, oversized files, malformed JSON, mismatched identities, and files outside the runtime directory.
- Coordinator tests prove standard dialogs are unchanged, Question responses are sent once, and `cancelAll()` cancels both standard and Question dialogs.
- Runtime tests prove launch args/env are scoped per process and temporary resources are removed on stop, failed start, and restart.

## Phase 3: Configuration and applied-process state

- [ ] Add a resource-scoped `frostpi.questionTool.enabled` setting with default `false`.
- [ ] Read the setting into `FrostPiConfiguration` and inject the bundled extension only when enabled at process start.
- [ ] Track configured versus applied state for running sessions and expose `restartRequired` when they differ.
- [ ] Configuration changes refresh the displayed state without interrupting the current Pi process.
- [ ] Add a compact session-menu row that opens FrostPi settings and states Disabled, Enabled, or Restart required.
- [ ] Preserve Pi extension priority: project/global `question` tools remain effective when loaded before FrostPi's explicit bundled extension.

**Agent Check**:

- Configuration tests cover the default and explicit enabled value.
- Session tests prove enabling/disabling affects only newly started or restarted processes.
- Existing proxy restart-required behavior remains independent and unchanged.

## Phase 4: Typed Host-Webview bridge

- [ ] Represent a pending Question as a discriminated subtype of the existing pending Extension UI model.
- [ ] Add a structured `respondQuestion` Webview message with bounded answers, optional note, and cancellation.
- [ ] Route that message through `WebviewBridge` → `SessionRegistry` → `SessionRuntime` while validating session ownership and pending request identity.
- [ ] Keep ordinary `respondExtensionUi` messages and standard input/select/editor/confirm cards unchanged.
- [ ] Let existing session snapshots/deltas carry pending Question requests; do not add a parallel Host-to-Webview channel.

**Agent Check**:

- Invalid or stale Question responses are rejected and cannot answer another session/request.
- Snapshot/delta reconstruction preserves pending Question payloads.
- Existing bridge schema and Extension UI tests continue to pass.

## Phase 5: Webview Question experience

- [ ] Add a Question host that partitions Question requests from ordinary Extension UI cards.
- [ ] Present one active Question request at a time with a compact request switcher when multiple requests are pending.
- [ ] Use a docked, height-bounded panel with an independently scrolling body; the conversation remains visible and independently scrollable.
- [ ] Support collapse to a compact request bar and restore without losing mounted in-memory drafts.
- [ ] Implement single- and multi-question navigation, predefined option selection, explicit written-answer editing, answer replacement, optional overall note, Cancel, and final Submit.
- [ ] Require every question to be answered before Submit. A single question follows the same explicit Submit rule.
- [ ] Keep feature-private styling scoped to the new Svelte components and maintain keyboard/focus accessibility at 280 px width.

**Agent Check**:

- Pure draft-state tests cover selection, written answers, replacement, completion, optional note, and submission encoding.
- Component tests cover request switching, collapse/restore, disabled Submit, explicit cancel, and submission payload.
- `pnpm --dir apps/vscode exec vitest run` focused on Question/Extension UI tests passes.

**User Check**:

1. Open a long conversation and trigger a multi-question request.
2. Scroll the conversation while the Question panel remains open.
3. Collapse and restore the panel; confirm answers remain intact.
4. Change predefined and written answers before Submit.
5. Confirm Submit remains disabled until every question is answered.
6. Repeat at approximately 280 px width and under light, dark, and high-contrast themes.

## Phase 6: Compatibility documentation and final verification

- [ ] Document the optional bundled tool, next-process activation rule, existing-tool priority, Remote SSH behavior, and `PI_INSIDE_FROSTPI` guidance.
- [ ] Update the feature map and durable Extension UI/RPC/UI boundary documents without duplicating implementation detail from code.
- [ ] Reconcile `DEV_SPEC.md` with any implementation evidence and remove unresolved statements that no longer apply.

**Agent Check**:

```bash
pnpm check
pnpm build
pnpm package:vsix && pnpm verify:vsix
```

- The packaged VSIX contains the bundled Question extension artifact.
- With the feature disabled, startup args do not contain the Question extension.
- With the feature enabled in a Remote SSH-equivalent Extension Host environment, the form completes without external TUI usage.

# Part II | Change-Shape Preview

Estimated footprint: approximately 25 modified/created files. Most changes are thin wiring or tests; the substantive new code is concentrated in four files: the private protocol, Pi extension, Extension Host bridge, and Question form.

```text
changes/
└── frostpi-question-tool/
    ├── DEV_SPEC.md                                      modify  +0–30/-0–10   — reconcile final decisions and implementation evidence
    └── PLAN.md                                          create  ~230 lines    — execution plan and change-shape preview

apps/vscode/
├── package.json                                         modify  +8–12         — add disabled-by-default questionTool setting
├── esbuild.config.mjs                                   modify  +10–15        — build bundled question-tool extension artifact
├── pi-extensions/
│   └── question-tool.ts                                 create  ~180–240      — register compatible tool; publish request; await/parse response
├── src/
│   ├── shared/
│   │   ├── question-tool/
│   │   │   └── questionToolProtocol.ts                  create  ~180–240      — private marker, schemas, limits, serializable contracts
│   │   ├── model/
│   │   │   ├── extensionUiModel.ts                      modify  +20–35/-2–5   — add discriminated pending Question view
│   │   │   └── sessionViewModel.ts                      modify  +10–18        — expose applied/configured Question-tool state
│   │   └── bridge/
│   │       └── webviewToHost.ts                         modify  +15–25        — structured respondQuestion message schema
│   ├── extension/
│   │   ├── activate.ts                                  modify  +2–5          — refresh Question setting state on configuration change
│   │   ├── configuration/
│   │   │   ├── configurationTypes.ts                    modify  +2–5          — add questionTool enabled configuration
│   │   │   └── readConfiguration.ts                     modify  +2–5          — read disabled-by-default setting
│   │   ├── question-tool/
│   │   │   └── QuestionToolExtensionBridge.ts           create  ~200–280      — runtime temp dir/token, marker/file validation, response encoding
│   │   ├── extension-ui/
│   │   │   ├── ExtensionUiCoordinator.ts                modify  +25–45/-3–8   — enqueue resolved Question dialog; reuse response/cancel ownership
│   │   │   └── extension-ui.SPEC.md                     modify  +8–15         — document authenticated private-input specialization
│   │   ├── conversation/
│   │   │   └── SessionProjection.ts                     modify  +5–12         — project Question-tool applied/configured state
│   │   ├── sessions/
│   │   │   ├── SessionRegistry.ts                       modify  +20–35/-3–8   — artifact path, structured response routing, runtime construction
│   │   │   └── SessionRuntime.ts                        modify  +70–110/-5–15 — bridge lifecycle, event interception, config/applied state
│   │   └── webview-host/
│   │       └── WebviewBridge.ts                         modify  +8–15         — dispatch typed Question submit/cancel
│   └── webview/
│       └── features/
│           ├── extension-ui/
│           │   ├── ExtensionUiHost.svelte               modify  +15–25/-2–5   — partition standard dialogs and Question requests
│           │   └── ExtensionUiRequestCard.svelte        modify  +2–8          — narrow props to standard dialog subtype
│           ├── question-tool/
│           │   ├── QuestionToolHost.svelte              create  ~130–190      — dock, collapse, pending-request switching
│           │   ├── QuestionForm.svelte                  create  ~250–360      — editable questions, custom answers, note, cancel/submit
│           │   └── questionDraft.ts                     create  ~90–140       — pure draft transitions and submission construction
│           └── sessions/
│               └── SessionHeader.svelte                 modify  +10–20        — configured/applied/restart-required settings row
└── test/
    └── unit/
        ├── questionToolProtocol.test.ts                  create  ~120–180      — marker/schema/limit/response tests
        ├── QuestionToolExtensionBridge.test.ts           create  ~180–260      — temp resource, validation, isolation, cleanup tests
        ├── questionDraft.test.ts                         create  ~100–150      — answer/edit/completion/submission state tests
        ├── QuestionToolHost.test.ts                      create  ~120–180      — collapse, switching, cancel and submit component behavior
        ├── ExtensionUiCoordinator.test.ts                modify  +50–80        — specialized pending dialog and exactly-once response
        ├── SessionRuntime.test.ts                        modify  +80–130       — launch/config/event/lifecycle integration
        └── SessionRegistry.test.ts                       modify  +20–40        — typed response routing and session ownership

docs/
├── feature-map.md                                       modify  +10–18        — map Question tool implementation entry points
├── protocol/pi-rpc-compatibility.md                     modify  +8–15         — record standard RPC UI + private temp request boundary
└── design/ui-spec.md                                    modify  +8–15         — durable dock/collapse/conversation-visibility rules

README.md                                                 modify  +15–25        — user setup, conflict priority, PI_INSIDE_FROSTPI guidance
```

## Shape Review

### Complexity concentration

- `questionToolProtocol.ts` owns wire identity and validation decisions.
- `QuestionToolExtensionBridge.ts` owns process-scoped temporary resources and request loading.
- `ExtensionUiCoordinator.ts` remains the sole owner of pending Pi UI responses and cancellation.
- `QuestionForm.svelte` owns feature interaction; styles remain scoped there and in `QuestionToolHost.svelte`.

### Expected thin files

Configuration, projection, registry, bridge dispatch, header, and documentation changes should remain small. If any grows into a new policy owner, extract only after identifying the hidden decision it needs to own.

### Warning thresholds

Reassess before continuing if implementation produces any of these shapes:

- changes under `packages/pi-rpc` to support the private form;
- a Question-specific file watcher, polling service, or response-file reader;
- Question pending state duplicated outside `ExtensionUiCoordinator`;
- more than one new Extension Host feature class;
- a generic schema-driven form framework;
- Question CSS added to `styles/composer.css`, `styles/sessions.css`, or another global style bag;
- answer drafts persisted in workspace state or temporary files;
- model-facing tool parameters changed for transport-only reasons.
