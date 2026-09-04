---
title: Response annotation implementation handover
created: 2026-09-05T02:18:23+08:00
consumed: false
---

## Assume Reader

A fresh Pi Coding Agent continuing in this repository on branch `feat/response-annotation`. The reader can inspect Git history, the accepted SHAPE, current source, and tests, but should assume no access to the originating chat.

## Background Context

FrostPi is adding a lightweight way to annotate a completed Agent response and turn the annotations into an ordinary Composer prompt. The feature must remain a Webview-local prompt constructor rather than a Pi, bridge, or persisted Session entity. The accepted architecture and predicted diff are in [`response-annotation.SHAPE.md`](response-annotation.SHAPE.md); the disposable interaction reference is [`prototype.html`](prototype.html).

## Current Status

The implementation is committed at `0012e1a` on `feat/response-annotation`; the earlier accepted design/prototype commit is `b63e303`. The working tree was clean immediately before this handover was created. There are no known structural blockers. The next required evidence is the user's test in a real FrostPi Extension Development Host, followed by any corrections and final verification.

The SHAPE remains `status: accepted`, not `completed`, because real-product UI feedback and the final implementation-to-SHAPE comparison are still pending.

## Trajectory

**Product and architecture:** The chosen flow is an unobtrusive `Annotate` action beside `Copy` on finalized textual assistant responses. It opens a temporary review workspace over a frozen raw-Markdown snapshot. Ordinary conversation selection remains untouched, and no Host, shared bridge, or Pi RPC annotation concept was added.

**Prompt contract:** The generated block is fixed ASCII Markdown from `==== ANNOTATIONS ====` through `==== END ANNOTATIONS ====`. It has no natural-language preamble, localization inference, configurable template, full-response copy, or user-input placeholder. The block is prefixed to the current Composer text with two newlines; existing text/images remain intact, focus moves to the end, and nothing sends automatically.

**Implementation:** `features/annotation-review/` now owns range modeling, source-selection mapping, Webview-lifetime Session-keyed review state, fixed prompt formatting, the floating note editor, and the responsive review workspace. `SessionInteraction` coordinates workspace/Composer stages; `App.svelte` prunes review state when a Session leaves the current presentation.

**Hardening:** An independent read-only code review found five issues, all addressed before `0012e1a`: Session-removal cleanup, correct edit-dirtiness confirmation, native modal focus behavior, live-region status announcements, and accurate narrow-layout scrolling documentation. Raw source uses a mutation-blocked contenteditable surface so keyboard users can select with Shift+navigation; a real Chromium check confirmed keyboard selection and mutation prevention.

## Key Information for the Successor

- Preserve the accepted non-invasion boundary: do not add bridge messages, Host persistence, Pi protocol types, or auto-send behavior without returning the SHAPE to `draft` and obtaining user approval.
- Review drafts are isolated per Session and per Webview presentation. They survive Session switching in the same Webview, but not presentation transfer, Webview destruction, or Session removal.
- The exact prompt envelope is a user-approved contract. Composer insertion places it before existing draft text, not after it.
- Required Extension UI requests remain reachable below the review workspace.
- The user explicitly asked that real UI testing be handed to them. Do not rebuild temporary Vite/Chrome harnesses; use automated tests/typecheck/build locally and ask the user to exercise the actual extension.
- The original external SiYuan HTML was inspiration only and had known occasional selection failures. Production behavior was independently implemented and must not be replaced with copied logic from that file.
- One pre-existing Svelte accessibility warning remains in `features/extension-ui/ExtensionUiRequestCard.svelte`; it is unrelated to this change.
- Actual file spread is slightly larger than the SHAPE estimate because scoped component CSS and accessibility behavior are substantial. Boundaries remain as accepted; `annotationSelection.ts` and `App.svelte` are the notable small prediction deviations.

## Verification Evidence

After the final hardening changes:

- `pnpm --dir apps/vscode lint` — passed.
- `pnpm --dir apps/vscode typecheck` — passed with only the unrelated existing warning noted above.
- Targeted Vitest set — 5 files, 18 tests passed:
  - `annotationPrompt.test.ts`
  - `annotationReviewModel.test.ts`
  - `annotationReviewStore.test.ts`
  - `responseAnnotationSelection.test.ts`
  - `composerDraftSync.test.ts`
- `slsp diagnostics` reported zero diagnostics for the main workspace, store, shell, and Composer-sync files before the last local hardening; subsequent package typecheck passed.
- A full `pnpm check` passed at the preceding implementation checkpoint (63 VS Code test files / 362 tests plus builds), but it predates the final review fixes. Run it again after user feedback and before completion.

## Next Actions

1. Ask the user to test `feat/response-annotation` in the real FrostPi UI, especially Annotate visibility, mouse/keyboard selection, overlapping notes, edit/cancel/discard, 280px layout, Session switching, and insertion before a non-empty Composer draft with attachments.
2. Reproduce and fix only reported or independently verified issues; keep changes inside the accepted boundaries.
3. Run the narrowest relevant tests during corrections, then final `pnpm check`.
4. Compare the final diff with [`response-annotation.SHAPE.md`](response-annotation.SHAPE.md), record material deviations if any, and set its status to `completed`.
5. Create the final non-WIP commit. Decide whether to squash the `0012e1a` checkpoint when preparing final branch history.

## File Reference Map

- Accepted direction and diff prediction: [`response-annotation.SHAPE.md`](response-annotation.SHAPE.md)
- Durable feature contract: [`annotation-review.SPEC.md`](/apps/vscode/src/webview/features/annotation-review/annotation-review.SPEC.md)
- Main review UI: [`ResponseAnnotationWorkspace.svelte`](/apps/vscode/src/webview/features/annotation-review/ResponseAnnotationWorkspace.svelte)
- Review state: [`annotationReviewStore.svelte.ts`](/apps/vscode/src/webview/features/annotation-review/annotationReviewStore.svelte.ts)
- Prompt formatter: [`annotationPrompt.ts`](/apps/vscode/src/webview/features/annotation-review/annotationPrompt.ts)
- Conversation trigger: [ResponseActivity.svelte`](/apps/vscode/src/webview/features/conversation/ResponseActivity.svelte)
- Stage/Composer coordination: [`SessionInteraction.svelte`](/apps/vscode/src/webview/shell/SessionInteraction.svelte)
- Draft composition: [`composerDraftSync.ts`](/apps/vscode/src/webview/features/composer/composerDraftSync.ts)
