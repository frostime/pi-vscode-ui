---
title: Session Tree Navigation Implementation Plan
description: Execution plan and change-shape preview for FrostPi v0.8-ready in-place session branching.
updated: 2026-07-24
status: in-progress
source-spec: backlog/support-session-tree.DEV-SPEC.md
---

# Session Tree Navigation Implementation Plan

Per `backlog/support-session-tree.DEV-SPEC.md`, FrostPi will provide conversation-first in-place branching through a bundled private Pi extension. This task ends release-ready without changing the product version or CHANGELOG.

## Part I | Execution Plan

### Phase 1: Private Pi extension artifact and transport contract ✅

- [x] Add a bundled `session-tree` Pi extension that registers one private command, validates a Base64URL request and per-runtime token, waits for Pi idle state, invokes `ctx.navigateTree()`, and writes only bounded navigation metadata into its runtime-owned result directory.
- [x] Build the extension as a separate Node ESM artifact under `dist/pi-extensions/`; keep Pi itself an external user installation rather than an application dependency.
- [x] Add `PiRpcApi.executeExtensionCommand()` as the explicit no-request-deadline path for an extension command that may wait for Extension UI or branch summarization.
- [x] Model current Pi command provenance (`sourceInfo.path`) while retaining additive-field compatibility.
- [x] Require the bundled artifact in VSIX verification and include its source in lint/typecheck scope.

**Agent Check**:
- [x] `packages/pi-rpc/test/PiRpcApi.test.ts`: private extension command uses a `prompt` request with no deadline.
- [x] `apps/vscode/test/unit/sessionTreeExtension.test.ts`: malformed payload, wrong token, cancellation, successful navigation, summary options, bounded metadata, arbitrary output path rejection, and committed-vs-failed error classification.
- [x] `pnpm --dir apps/vscode build`: emits `apps/vscode/dist/pi-extensions/session-tree.js`.
- [x] Focused lint and typecheck pass for `packages/pi-rpc` and `apps/vscode`.

### Phase 2: Pure session-tree projection ✅

- [x] Implement a pure tree module that consumes complete `get_entries` data and `leafId`, validates parent links defensively, and derives children, active path, branch points, reachable branch ends, and current position.
- [x] Derive compact branch controls anchored before/after the nearest active-path user message; do not retain raw image bytes in the projected view.
- [x] Build QuickPick-ready choices with divergence previews, nested divergence breadcrumbs, message count, ending preview/type, current-path marker, and deterministic ordering.
- [x] Project editable targets (Pi user/custom messages) to Composer text/images only at operation time; reuse FrostPi attachment validation before navigation.
- [x] Handle root branching, orphan roots, metadata-only ends, duplicate text/timestamps, nested branches, summaries, and a non-terminal active leaf without guessing by text.

**Agent Check**:
- [x] `apps/vscode/test/unit/sessionTreeProjection.test.ts`: 7 focused tests cover active paths, nested/root branches, active/non-active ends, current non-terminal position, fallback labels, stable ordering, editable target images, and malformed parent references.
- [x] VS Code lint and typecheck pass with the pure module in scope.

### Phase 3: Runtime ownership, capability discovery, and post-navigation reconciliation ✅

- [x] Add a feature-specific `SessionTreeExtensionBridge` that owns the bundled path, launch args/environment, random token, per-runtime temporary result directory, command discovery by source path, request/result validation, and cleanup.
- [x] Inject `-e <absolute bundled artifact>` into every Pi process while preserving user arguments, user extensions, and explicit `--no-extensions` semantics.
- [x] Discover Pi's final private command name, including collision suffixes; filter every bundled command from user-facing completion.
- [x] Extend runtime/projection state with capability availability, compact branch controls, and `isNavigatingTree`; refresh the compact index from existing full/incremental `get_entries` flows.
- [x] Add Runtime operations to list authoritative branch ends and navigate to a validated entry under idle/history/queue/Extension-UI guards.
- [x] On success, atomically reconcile `get_state`, `get_messages`, complete `get_entries`, stats, branch controls, and optional Composer seed without replacing runtime/session identity.
- [x] On Pi cancellation or pre-commit failure, retain current projection. On committed-navigation hydrate failure, retain Pi authority, set retryable failed-history state, and avoid reverse navigation.
- [x] Hydrate Pi `branchSummary` messages into a separate conversation-boundary projection.

**Agent Check**:
- [x] Runtime and bridge tests verify launch args/environment, source matching, collision suffix use, command hiding, missing capability, cancellation, no-summary and summary requests, same runtime/session identity, text/image seed, full rehydrate, temp cleanup, and committed hydrate failure.
- [x] Projection tests verify compact branch state, content/image stripping, and branch-summary hydration without exposing raw entries to the Webview.
- [x] 43 focused tests pass across Runtime, bridge, bundled extension, tree projection, session projection, and turn projection; VS Code lint and typecheck pass.

### Phase 4: Host-native interaction and validated Webview actions ✅

- [x] Add native VS Code pickers for branch ends and summary mode; custom summary uses an InputBox.
- [x] Add Registry orchestration for **Branch here** and **Switch branch**, including active-session checks, target revalidation, draft replacement confirmation, and current-path no-op.
- [x] Extend the versioned Webview→Host schema for the two actions; carry only session id, stable Pi entry/branch-point id, and whether a draft currently exists.
- [x] Bump the opaque bridge version and dispatch actions through `WebviewBridge`; errors use the existing toast path.
- [x] Apply no-summary as the default; do not expose an in-progress summary cancel action.

**Agent Check**:
- [x] Picker and Registry tests cover target/current selection, none/default/custom summary options, picker/input cancellation, draft confirmation, same-session seed, and current-path no-op.
- [x] Bridge schema tests accept valid bounded actions and reject missing, oversized, or malformed ids/fields.

### Phase 5: Conversation UI and generic Composer seed 🚧 awaiting manual check

- [x] Add **Branch here** beside Copy/Fork with distinct accessible labels/tooltips; preserve Fork's new-session meaning.
- [x] Render `Switch branch · <count> paths` before the first visible active-alternative item selected by Host projection; clicking opens the Host QuickPick.
- [x] Render `branchSummary` as a collapsed `Branch summary` boundary with expandable Markdown.
- [x] Show non-cancellable `Switching branch`/`Summarizing branch` progress, disable conflicting Composer/model/message actions, and expose unavailable-capability guidance through the disabled action tooltip.
- [x] Extract the existing one-shot Composer seed application from Fork-specific client naming so both Fork and Tree navigation use the same host-validated text/image behavior.
- [x] Preserve a non-empty draft for non-editable targets; replace it only after the agreed confirmation for editable targets.

**Agent Check**:
- [x] Webview unit tests prove each seed applies once under the same session id, preserves validated images, and sends only bounded tree-action metadata.
- [x] Typecheck/Svelte checks prove branch controls and summary boundaries consume only shared serializable models.
- [ ] Manual user check: Branch here, nested branch picker, editable/non-editable ends, summary modes, disabled capability, keyboard focus, and draft behavior under VS Code light/dark/high-contrast at 280 px and normal widths.

### Phase 6: Durable contracts, release documentation, and full verification 🚧 in progress

- [x] Update protocol, lifecycle, session-catalog, bridge, Composer, and UI specifications with the private-extension boundary, in-place mutation, failure semantics, branch controls, and summary presentation.
- [x] Update root and packaged README feature descriptions.
- [x] Mark the session-tree research backlog implemented via the private extension and record that the generic bundled-extension framework remains deferred.
- [x] Keep `backlog/support-session-tree.DEV-SPEC.md` and this plan as the approved change artifacts.
- [x] Do not change version or CHANGELOG.

**Agent Check**:
1. [x] Focused tests for Pi RPC, extension bridge, tree projection, Runtime, Registry, projection, Composer seed, and bridge schema pass.
2. [x] `pnpm check` passes (5 Pi RPC files / 14 tests; 40 VS Code files / 212 tests).
3. [x] `pnpm build` passes and emits both Extension Host/Webview bundles plus the private Pi extension artifact.
4. [x] `pnpm package:vsix && pnpm verify:vsix` passes; archive inspection confirms the private artifact is present and source/tests/maps are absent.
5. [x] Real-Pi capability and no-summary navigation smoke pass with a sequential RPC harness: explicit `-e` loads under `--no-extensions`, source provenance matches the artifact, the private result commits, active leaf changes to the target user's parent, and Pi session identity remains unchanged.

**User Check**:
- Review the final file-shape diff against Part II.
- Install the VSIX in a clean host with the intended Pi line and exercise the v0.8 session-tree workflow before release.
- Exercise default/custom-focus summaries and submit the restored prompt before restart; these paths may invoke the configured model and are intentionally excluded from the model-free automated smoke.

## Part II | Change-Shape Preview

```text
packages/pi-rpc/
├── src/
│   ├── PiRpcApi.ts                              modify  +8/-0       — no-deadline extension-command request helper
│   └── protocol/rpcTypes.ts                     modify  +10/-0      — current get_commands source provenance shape
├── test/PiRpcApi.test.ts                        modify  +16/-0      — exact private-command prompt/deadline contract
└── SPEC.md                                      modify  +6/-0       — extension-command request semantics

apps/vscode/
├── pi-extensions/
│   └── session-tree.ts                          create  ~110 lines  — private command adapter to ctx.navigateTree
├── src/
│   ├── extension/
│   │   ├── session-tree/
│   │   │   ├── SessionTreeExtensionBridge.ts    create  ~190 lines  — launch/capability/token/result-directory protocol
│   │   │   ├── sessionTreeProjection.ts         create  ~280 lines  — pure graph, anchors, ends, labels, target seed
│   │   │   └── SessionTreePicker.ts             create  ~130 lines  — native target/summary/draft interactions
│   │   ├── sessions/
│   │   │   ├── SessionRuntime.ts                modify  +190/-20    — bridge lifecycle, tree state, navigate + rehydrate
│   │   │   ├── SessionRegistry.ts               modify  +135/-5     — active-session orchestration and picker flow
│   │   │   ├── session-lifecycle.SPEC.md        modify  +28/-2      — in-place tree lifecycle and recovery contract
│   │   │   └── session-catalog.SPEC.md          modify  +5/-3       — remove tree navigation from catalog non-goals
│   │   ├── conversation/
│   │   │   ├── SessionProjection.ts             modify  +32/-2      — navigation/capability/branch-point state
│   │   │   └── TurnProjection.ts                modify  +32/-2      — branchSummary history projection
│   │   └── webview-host/WebviewBridge.ts        modify  +22/-0      — dispatch validated tree actions
│   ├── shared/
│   │   ├── bridge/
│   │   │   ├── bridgeVersion.ts                 modify  +1/-1       — required bridge contract bump
│   │   │   ├── webviewToHost.ts                 modify  +22/-0      — Branch here / Switch branch schemas
│   │   │   └── webview-bridge.SPEC.md           modify  +12/-2      — action and same-session seed semantics
│   │   └── model/
│   │       ├── conversationModel.ts             modify  +16/-0      — branch summary and branch-control views
│   │       └── sessionViewModel.ts              modify  +20/-0      — capability/navigation/branch state
│   └── webview/
│       ├── bridge/applyHostMessage.ts            modify  +4/-4       — generic one-shot Composer seed application
│       └── features/
│           ├── composer/
│           │   ├── Composer.svelte              modify  +8/-2       — disable/progress behavior during navigation
│           │   ├── composerSeedClient.ts        create  ~38 lines   — shared Fork/Tree seed application
│           │   └── composer.SPEC.md             modify  +10/-1      — same-session seed and draft replacement rules
│           ├── conversation/
│           │   ├── BranchPointControl.svelte    create  ~75 lines   — compact Switch branch control
│           │   ├── BranchSummaryBlock.svelte    create  ~65 lines   — collapsed Markdown summary boundary
│           │   ├── sessionTreeClient.ts         create  ~40 lines   — bounded Webview action helpers
│           │   ├── ConversationView.svelte      modify  +18/-2      — summary timeline and operation progress
│           │   ├── UserMessage.svelte           modify  +42/-4      — Branch here + anchored branch controls
│           │   └── forkMessageClient.ts         modify  +0/-30      — retain Fork only; remove seed ownership
│           └── sessions/SessionHeader.svelte    modify  +4/-0       — navigation status label
├── test/unit/
│   ├── SessionTreeExtensionBridge.test.ts       create  ~190 lines  — private bridge lifecycle/security/result tests
│   ├── sessionTreeProjection.test.ts            create  ~280 lines  — graph/label/anchor/seed behavior matrix
│   ├── sessionTreeExtension.test.ts             create  ~130 lines  — bundled Pi command adapter behavior
│   ├── SessionRuntime.test.ts                   modify  +155/-5     — process/capability/navigation/recovery integration
│   ├── SessionRegistry.test.ts                  modify  +135/-5     — native interaction orchestration
│   ├── SessionProjection.test.ts                modify  +28/-0      — compact branch state + summary boundary
│   ├── TurnProjection.test.ts                   modify  +22/-0      — branchSummary hydrate behavior
│   ├── webviewBridgeSchema.test.ts              modify  +38/-0      — new action validation
│   └── composerSeedClient.test.ts               rename  +6/-6       — generic same-session Composer seed assertions
│       (from forkMessageClient.test.ts)
├── esbuild.config.mjs                           modify  +20/-3      — build host CJS and private extension ESM
├── package.json                                 modify  +2/-2       — lint/typecheck coverage for pi-extensions
└── README.md                                    modify  +6/-0       — packaged Marketplace feature highlight

scripts/
└── verify-vsix.mjs                              modify  +2/-0       — require packaged private extension artifact

docs/
├── architecture/session-state-machine.md        modify  +8/-0       — in-place navigation state transition
├── design/ui-spec.md                            modify  +18/-1      — Branch here, path picker, summary boundary
└── protocol/pi-rpc-compatibility.md             modify  +18/-2      — get_entries + private extension compatibility

backlog/
├── support-session-tree.md                      modify  +12/-4      — implemented-via-plugin status and final boundary
├── bundled-pi-extensions.md                     modify  +10/-2      — record feature-specific implementation, generic framework deferred
├── support-session-tree.DEV-SPEC.md             modify  +35/-10     — approved requirements and design decisions
└── support-session-tree.PLAN.md                 create  ~250 lines  — execution plan and complete change footprint

README.md                                        modify  +8/-1       — user-facing in-place branching workflow
```

Estimated final production change: roughly **1,300–1,550 added lines** and **80–110 removed lines**, plus roughly **950–1,100 lines of focused tests/docs/artifacts**. The largest complexity stays in three feature-owned modules (`SessionTreeExtensionBridge`, `sessionTreeProjection`, `SessionTreePicker`) rather than further expanding Runtime, Registry, or Webview bridge into parallel tree implementations.
