---
title: Session Tree Navigation Development Specification
description: Temporary implementation contract for in-place Pi session branching and branch navigation in FrostPi.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-07-24
status: aligned
---

# Session Tree Navigation Development Specification

## Problem Statement

FrostPi can create a separate session through message-level Fork, but cannot navigate and continue from another entry in the same Pi session file. Users need to revise an earlier prompt, preserve alternate paths in one session tree, and return to an existing branch without leaving the FrostPi conversation UI.

Pi owns session tree, active leaf, context reconstruction, and branch-summary semantics. Pi RPC can read the complete tree but does not expose tree navigation. Pi's extension command API does expose `navigateTree`, so FrostPi requires a bundled private Pi extension as the temporary adapter.

## Approach

FrostPi will inject a bundled private Pi extension into each Pi RPC process. The Extension Host will derive the tree from Pi's complete `get_entries` response, collect the user's navigation choice, invoke the private extension command, then rebuild the displayed active branch from Pi. FrostPi will not edit session JSONL or reproduce Pi's leaf/context mutation rules.

The product interaction will live in the graphical conversation rather than requiring a complete `/tree`-equivalent graph in v0.8:

- a **Branch here** action on completed user messages will navigate to that message for editing and resubmission in the same session;
- a compact control at each represented branch point will open a native VS Code QuickPick containing the reachable branch ends;
- the QuickPick will show enough divergence and ending context to distinguish similar branches without displaying a complete graph.

A complete tree graph, `/tree` Composer command, and Command Palette tree browser are deferred.

## Behavior Contract

### In-place branching from a user message

- A completed user message can be selected as the point to revise.
- Before navigation, FrostPi asks how to handle the branch being left:
  1. no branch summary (default);
  2. branch summary with Pi's default instructions;
  3. branch summary with user-provided focus instructions.
- Successful navigation keeps the FrostPi session id, Pi process, and Pi session file unchanged.
- The selected user message is removed from the active displayed history because Pi moves the leaf to its parent.
- The selected message's text and valid image attachments are restored to the Composer for editing and resubmission.
- Resubmission creates a new path in the same Pi session tree.

### Existing branch navigation

- FrostPi identifies branch points from Pi's complete tree and identifies the active path from Pi's current leaf.
- A compact `Switch branch · <count> paths` control appears immediately before the first visible conversation item on the active alternative after a branch point.
- The control opens a native VS Code QuickPick listing every branch end reachable below that branch point. If the active leaf is not itself a branch end, the current position is also represented.
- Each item identifies the path using the first meaningful text after each nested divergence, shows message count and update time, and describes the ending role/text. A user-message end explicitly states that it will open in the Composer.
- The current path is first; other paths are ordered by ending time, newest first. Selecting the current path closes the picker without navigation or summary interaction.
- Successful selection of an existing target replaces the displayed conversation with Pi's resulting active branch.
- Selecting a user-message target follows Pi semantics: navigate to its parent and restore that message to the Composer.
- Selecting a non-user target moves the leaf to that target and preserves the current Composer draft.
- A selection that will restore a user message asks for confirmation before replacing a non-empty Composer draft.
- QuickPick text falls back from user text to assistant text, branch summary, then compaction/tool/entry type plus a shortened entry id when richer content is unavailable.

### Branch summary presentation

- A generated branch summary is visible as a `Branch summary` conversation boundary.
- The boundary is collapsed by default and can be expanded to inspect the complete summary.

### Summary and cancellation

- No summary is the default.
- Default and custom branch summaries are supported in v0.8.
- Cancelling before extension invocation changes no Pi or FrostPi state.
- Pi RPC currently has no non-disruptive way to abort branch-summary generation after it starts. v0.8 will not claim an in-progress summary cancellation capability unless implementation evidence establishes one.

### Availability and failure

- FrostPi probes for its bundled private extension capability instead of assuming successful loading.
- Capability discovery matches the bundled extension's source path and uses Pi's final command name, including any collision suffix. Bundled commands are removed from user-facing command completion.
- If the private extension is unavailable, tree actions are disabled with guidance to update Pi, restart the session, and inspect FrostPi diagnostics; no session mutation occurs.
- Navigation cancellation, extension failure, summary failure, and result-validation failure before commit leave the current logical session unchanged.
- No navigation path creates a new FrostPi session or rebinds the runtime.
- Once the private result confirms that Pi changed its leaf, Pi state remains authoritative. A later hydrate failure marks conversation history failed and offers the existing retry path; FrostPi does not attempt an automatic reverse navigation or claim rollback.

### Compatibility and privacy

- The bundled extension is injected by absolute path and does not modify user or project Pi configuration.
- User-installed Pi extensions continue to load.
- FrostPi's private command is discovered for Host use but filtered out of user-facing Composer completion. FrostPi does not expose `/tree` as a secondary v0.8 entry point.
- Prompts, responses, branch-summary text, image bytes, credentials, private tokens, and unredacted proxy URLs are not logged or written to result files.
- The private command does not accept an arbitrary result path. Each runtime owns a random token and OS temporary result directory; requests identify only a validated request id within that directory.

## Implementation Decisions

Settled decisions:

- Pi remains the sole owner of leaf mutation and context reconstruction.
- Navigation uses a bundled private Pi extension because native Pi RPC lacks `navigate_tree`.
- Tree reads use the existing documented `get_entries` RPC surface; entry parent links and `leafId` are sufficient to derive the complete tree without an additional `get_tree` request.
- Tree navigation is an in-place mutation, separate from Fork's session/runtime replacement lifecycle.
- Branch summary offers none/default/custom choices, with none selected by default.
- User-message restoration includes text and image attachments that pass FrostPi's existing attachment validation.
- Runtime keeps only a compact, content-bounded tree index needed to render branch controls. A user operation refetches complete entries before presenting targets or navigating; full entries and image bytes are not persisted in the FrostPi session catalog or Webview state.
- A complete Webview tree graph is outside v0.8 scope.
- The in-place user-message action is labeled **Branch here**.
- Existing branches are selected from a native QuickPick listing reachable branch ends.
- `/tree` and a Command Palette tree browser are outside v0.8 scope.
- A non-empty Composer draft is confirmed before replacement by a selected user message; navigation to a non-user entry preserves the draft.
- A feature-specific extension bridge owns capability discovery, a per-runtime random token, a per-runtime OS temporary result directory, Base64URL request encoding, bounded metadata result validation, and cleanup.
- The bundled extension is built as a separate ESM artifact under the packaged `dist/pi-extensions` tree and injected by absolute path.
- Result metadata contains navigation status and resulting leaf identity only; target text/images are projected from authoritative Pi entries and validated by existing attachment policy.
- `SessionRuntime` owns guards, capability, mutation, and post-navigation hydrate; `SessionRegistry` owns native VS Code interaction; a pure tree module owns traversal, compact branch controls, labels, and target projection.
- A committed navigation followed by hydrate failure remains committed and enters retryable failed-history state; FrostPi does not reverse-navigate automatically.
- Compatibility is capability-based rather than version-string-based because Pi RPC does not expose an authoritative product version. Missing capability guidance is: `Session tree navigation is unavailable in this Pi process. Update Pi, restart the session, and check FrostPi diagnostics.`

## Acceptance Criteria

- A user can revise an earlier user message and submit the revision as a new branch in the same Pi session file.
- The FrostPi session id and owned Pi process remain unchanged across successful navigation.
- The active conversation after navigation matches Pi's `get_messages` result and active entry path.
- Text and valid images from a selected user message are restored once to the Composer.
- The user can choose no summary, default summary, or custom summary instructions; no summary is the default.
- A generated branch summary appears once as a collapsed conversation boundary and expands to its complete text.
- Existing branch points are detected from Pi tree data; the conversation control lists every reachable branch end in a native VS Code QuickPick.
- Cancellation before navigation and Pi-side cancellation leave the current conversation and Composer unchanged.
- Missing bundled capability and navigation failures produce visible errors without creating or replacing a session.
- The bundled extension is present in the VSIX, loads by absolute path in development and packaged installations, coexists with user extensions, and remains available when automatic extension discovery is disabled.
- Focused protocol, runtime, tree-projection, interaction, packaging, and failure-path tests pass.
- `pnpm check`, `pnpm build`, `pnpm package:vsix`, and `pnpm verify:vsix` pass before release.
- The change is release-ready for v0.8 but does not change the product version or CHANGELOG in this task.
- User verification covers VS Code light, dark, and high-contrast themes at 280 px and normal panel widths.

## Glossary

- **Active leaf**: Pi entry that marks the current position in a session tree.
- **Active path**: Entries from the session root to the active leaf.
- **Branch point**: A Pi tree entry with more than one direct child.
- **Branch end**: A reachable entry with no children in the currently fetched Pi tree.
- **Branch summary**: Pi-generated context attached at the new position when leaving another branch.
- **Bundled private Pi extension**: Extension shipped inside FrostPi and injected into Pi with an explicit command-line path; it is not installed into user or project Pi configuration.
- **Fork**: Existing FrostPi behavior that creates a new Pi session file and replaces the live runtime identity.
- **In-place branching**: Navigating to an earlier user message and resubmitting it so Pi creates another path in the same session file.
- **Tree navigation**: Pi's in-place change of active leaf followed by context reconstruction.
