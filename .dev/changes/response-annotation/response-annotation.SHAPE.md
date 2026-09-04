---
status: accepted
---

# Response annotation change shape

## Proposed change

Add an explicit, secondary `Annotate` action to finalized textual assistant responses. The action opens a presentation-local review workspace over a frozen copy of that response's raw Markdown. Inside that workspace, text selection has annotation semantics; ordinary conversation selection remains unchanged.

The workspace owns range selection, highlights, note editing, and note ordering. Confirming the review produces one fixed annotation block and places it before the current Composer text. The existing draft and attachments remain intact, the Composer opens with its caret at the end, and nothing is sent automatically.

The feature stays entirely in the Webview. Pi RPC, conversation projection, Host–Webview schemas, and persisted Session state do not learn an annotation concept.

## Prompt contract

The generated block has no natural-language preamble or user-input placeholder:

```markdown
==== ANNOTATIONS ====

--- ANNOTATION 01 ---

> Referenced response text

The user's note, preserved as written.

==== END ANNOTATIONS ====
```

Rules:

- Notes are ordered by source start, then source end, then creation order.
- Every line of a quoted range is emitted as a Markdown blockquote line, including blank lines.
- Note text is preserved except for removing accidental leading and trailing whitespace from the note as a whole.
- Structural labels are fixed ASCII markers; they are not localized prose and do not determine the language of the user's subsequent instruction or the Agent's response.
- The formatter emits only the annotation block. There is no generated `{user input}` field.
- Composer composition is `annotation block + two newlines + existing draft`. With an empty draft, the caret lands after those newlines so the user can continue typing below the block.

This deliberately avoids a user template language, locale inference, configurable placeholders, and formatter migration obligations. If users later need recurring global instructions, that requirement should first be tested as a bounded preface setting rather than opening the item structure to arbitrary templates.

## Responsibility and lifecycle

- **Conversation response:** exposes a non-highlighted action only when the response is no longer streaming and has raw textual content. It supplies the same raw text used by `Copy`.
- **Review feature:** owns the frozen source snapshot, annotations, pending note draft, active highlight, prompt formatting, and discard confirmation.
- **Session interaction shell:** switches between normal interaction and the review workspace, preserves required Extension UI requests, and coordinates insertion into Composer.
- **Composer:** remains the only owner of the resulting prompt draft and its existing Sidebar/Panel synchronization behavior.
- **Extension Host / Pi:** receives nothing until the user explicitly sends the ordinary Composer draft.

One review draft may exist per Session in each Webview presentation. It survives Session switching and temporary Sidebar externalization while that Webview remains alive, but it does not cross between Sidebar and editor-panel Webviews and does not survive Webview destruction, reload, Extension Host restart, or Session removal. Back/discard warns before deleting saved or partially written review work.

A response is frozen when review begins. Later conversation updates, branch changes, or projection changes do not rewrite its text or ranges. Inserting a review after its source is no longer in Pi's active context remains allowed because each note carries its own quoted target; FrostPi does not promise that the full historical response remains available to the model.

If a blocking Extension UI request arrives during review, its request card remains reachable below the workspace. It neither discards nor silently closes the review draft.

## Architecture choice

### Recommended: Webview-local feature state with shell coordination

`annotation-review` is a cohesive Webview feature. It exposes intent-level operations to begin, mutate, discard, and format one review. `SessionInteraction` coordinates this feature with the Composer rather than letting the review component send prompts or understand draft authority.

This hides selection and range complexity inside one feature, keeps the prompt formatter pure and directly testable, and leaves existing Host authority and bridge recovery rules untouched. Debugging starts with one review-store entry keyed by Session id, then the pure formatted output, then the ordinary Composer draft.

### Rejected: annotate rendered Markdown inline

This would couple selection mapping and persistent marks to sanitized/rendered Markdown, Mermaid replacement, code-block chrome, streaming updates, and conversation scroll ownership. A small-looking action would leak annotation concerns through the Markdown renderer and produce unstable raw-source mapping.

### Rejected: Host-owned annotations or a new VS Code panel

This would add bridge payloads, validation, Session/presentation synchronization, persistence and recovery semantics before any product requirement needs them. It also turns a prompt-construction aid into a new Session entity.

### Rejected for the primary flow: quote directly into Composer

This is cheaper but loses the review workspace's batch overview, persistent source highlights, editing, and ordering. It may be considered later as a separate lightweight quoting action; the current design does not add an extension point for it.

## Predicted production diff

```text
apps/vscode/src/webview/
├── features/annotation-review/
│   ├── annotation-review.SPEC.md             create  +30–45
│   │   Durable trigger, lifecycle, prompt, insertion, and non-persistence contract.
│   ├── annotationReviewModel.ts              create  +90–130
│   │   Owns frozen-review types, validated ranges, stable sorting, and highlight segments.
│   ├── annotationReviewStore.svelte.ts       create  +65–95
│   │   Owns presentation-local review drafts keyed by Session id and immutable updates.
│   ├── annotationPrompt.ts                   create  +35–55
│   │   Pure owner of the fixed annotation-block format.
│   ├── AnnotationNoteEditor.svelte           create  +120–180
│   │   Owns multiline note input, focus, selection-anchor positioning, and narrow bottom-sheet layout.
│   └── ResponseAnnotationWorkspace.svelte    create  +280–380
│       Owns raw-source selection, highlights, note list, edit/delete/discard, and insertion intent.
├── features/conversation/
│   ├── AgentTurn.svelte                      modify  +1–4/-0–2       nearly all preserved
│   │   Supplies the Session id required to key a presentation-local review.
│   └── ResponseActivity.svelte               modify  +12–20/-1–4     nearly all preserved
│       Adds the ordinary `Annotate` response action and begins a frozen review.
├── features/composer/
│   ├── composerDraftSync.ts                  modify  +8–14/-0         additive
│   │   Adds an intent-level prefix operation that preserves existing text/images and draft authority.
│   ├── Composer.svelte                       modify  +5–10/-0         additive
│   │   Exposes focus-at-end to shell coordination without changing submission behavior.
│   └── PromptEditor.svelte                   modify  +7–12/-0         additive
│       Places the CodeMirror selection at document end on an explicit request only.
└── shell/SessionInteraction.svelte           modify  +35–55/-8–18    moderate conditional reorganization
    Chooses normal conversation/Composer versus review workspace, keeps blocking Extension UI reachable,
    prefixes the generated block, returns to normal interaction, and focuses the Composer.

apps/vscode/test/unit/
├── annotationPrompt.test.ts                  create  +55–85
│   Covers exact envelope, source ordering, multiline/blank-line quoting, and multiline notes.
├── annotationReviewModel.test.ts             create  +75–115
│   Covers range validation, overlap segmentation, and stable source ordering.
├── annotationReviewStore.test.ts             create  +55–85
│   Covers per-Session isolation, pending-note retention, discard, and frozen source ownership.
├── responseAnnotationSelection.test.ts       create  +75–120
│   jsdom behavior tests for offsets across fragmented/highlighted text nodes and whitespace trimming.
├── responseActivity.test.ts                  create  +35–55
│   Verifies action availability for finalized textual, streaming, and image-only responses.
└── composerDraftSync.test.ts                 modify  +20–35/-0       additive
    Verifies prefix ordering, exact preservation of existing draft/images, and Host-authority mutation.

.dev/docs/
├── design/ui-spec.md                         modify  +4–8/-0
│   Records the temporary review workspace, narrow-width behavior, and blocking-request reachability.
└── feature-map.md                            modify  +4–7/-0
    Routes future annotation-review work to its owner and local contract.
```

No changes are predicted under `apps/vscode/src/shared/`, `apps/vscode/src/extension/`, or `packages/pi-rpc/`. No global Webview style sheet should change: review chrome is feature-private and belongs in the two scoped Svelte components. Existing tokens and message-action primitives are reused.

## Dependency and ownership shifts

```text
Finalized ResponseActivity
        │ begin review with Session id + raw text snapshot
        ▼
annotationReviewStore ──► ResponseAnnotationWorkspace
        │                         │ format fixed block
        │                         ▼
        └──────── SessionInteraction ──► Composer draft prefix operation
                                                │ existing authority rules
                                                ▼
                                      Webview-local or Host-synchronized draft
```

- Conversation does not gain selection logic or annotation rendering.
- Annotation review does not import the bridge or submit prompts.
- Composer does not know why text is prefixed.
- `SessionInteraction` is the only module that knows the review workspace and Composer are alternate stages of one user flow.
- The formatter owns all structural marker knowledge; UI components do not assemble prompt fragments.

## Likely future changes and containment

- **Change marker wording or numbering:** formatter, formatter tests, and annotation-review SPEC only.
- **Add an optional full-response block:** formatter contract and workspace option; no protocol change.
- **Add another review source such as pasted text:** a new begin-review adapter can reuse the feature without modifying selection or Composer ownership.
- **Add localized UI:** component copy moves through the project's eventual localization mechanism; the fixed prompt body remains unchanged.
- **Persist or transfer reviews:** intentionally not absorbed by this shape. That would change the responsibility contract and require a new accepted shape covering Host ownership, bridge validation, and recovery.

## Deliberate cuts

The first implementation does not annotate streaming output, reasoning, tool calls, user messages, images, or rendered Markdown. It does not auto-send, include the complete response, infer language, configure templates, create prompt presets, synchronize reviews across presentations, or persist review data.

The prototype remains a disposable decision artifact and is not imported or promoted into production code. Cleanup or archival of `.dev/changes/response-annotation/` is decided after implementation review.
