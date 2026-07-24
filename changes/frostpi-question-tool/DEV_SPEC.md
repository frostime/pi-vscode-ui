---
title: FrostPi Private Question Tool — Development Specification
description: Product, protocol, lifecycle, compatibility, and UI contract for FrostPi's bundled Pi question tool.
scope:
  - /apps/vscode/pi-extensions/**
  - /apps/vscode/src/extension/**
  - /apps/vscode/src/shared/**
  - /apps/vscode/src/webview/**
  - /packages/pi-rpc/**
updated: 2026-07-25
---

# FrostPi Private Question Tool

## Problem Statement

Pi extensions can register interactive tools, but complex `ctx.ui.custom()` interfaces are unavailable in Pi RPC mode. The existing user-level `question` extension therefore falls back to an external terminal UI. This is inconvenient in normal FrostPi use and particularly disruptive in Remote SSH workspaces, where the user must leave the VS Code conversation surface to answer clarification questions.

FrostPi needs an optional bundled Pi extension that registers a compatible `question` tool and completes the interaction inside the FrostPi Webview. While answering, the user must retain access to conversation context needed as reference.

The feature is private to FrostPi-started Pi RPC processes. It does not define a portable ACP or general-purpose Pi RPC form protocol.

## Approach

FrostPi will bundle a Pi extension that registers `question` with the same public input and result contract as the existing questionnaire extension.

The private request path combines a per-session temporary file with Pi's standard blocking Extension UI protocol:

1. The tool writes the complete question request to a per-runtime temporary directory.
2. After the file is atomically committed, the tool calls a standard `ctx.ui.input()` dialog whose title contains a versioned FrostPi marker, runtime token, and request identifier.
3. Pi emits a normal `extension_ui_request` and suspends the tool until an `extension_ui_response` arrives.
4. The Extension Host recognizes the private marker before generic input rendering, reads and validates the corresponding request file, and projects a typed Question request to the Webview.
5. The Webview submits a structured answer through the normal Webview bridge.
6. The Extension Host serializes that answer into the standard Extension UI string `value` response.
7. The tool validates the returned value, removes its request file, and returns a normal Pi tool result.

The UI request is the notification that the request file is ready. No file watcher, polling loop, response file, or custom Pi RPC method is introduced.

## Behavior Contract

### Availability and activation

- The feature is disabled by default.
- A FrostPi setting controls whether the bundled extension is added when a Pi process starts.
- Changing the setting does not interrupt or mutate a running Pi process. The configured value applies after that session process is restarted or to a subsequently started process.
- FrostPi exposes that a running session is using an older applied value when the configured value has changed.
- The first implementation may expose the setting through VS Code Settings only. A dedicated Webview toggle is not required.
- Local, Remote SSH, WSL, and Dev Container workspaces follow the same behavior because Pi, the bundled extension, the Extension Host, and the temporary directory exist in the same execution environment.

### Tool compatibility

The tool name is `question`.

The accepted input contains one or more questions. Each question contains:

- a stable `id`;
- an optional short `label`;
- the full `prompt`;
- zero or more predefined options containing `value`, `label`, and an optional `description`.

The result preserves the established questionnaire result concepts:

- normalized questions;
- answers keyed by question id;
- whether each answer was predefined or written by the user;
- the optional overall note;
- cancellation state.

Adding the bundled extension must not make historical `question` tool calls unreadable or change the public parameter schema solely to support FrostPi transport.

### Answering

- Every request, including a single-question request, requires an explicit final Submit action.
- Every question must have an answer before Submit is enabled.
- A question is answered only when the user explicitly selects a predefined option or explicitly saves a written answer.
- A predefined selection can be replaced by another selection or by a written answer before submission.
- A written answer can be edited or replaced before submission.
- The user may add and edit one optional overall note independent of individual questions.
- Cancel is always available and resolves the tool as cancelled rather than leaving the tool blocked.
- Closing, stopping, or restarting the owning session cancels any pending request before terminating the Pi process.

### Multiple requests

- One session may own multiple pending Question requests.
- Requests are identified independently and must never consume another request's response.
- The Webview presents one active form at a time and provides a compact way to switch among pending requests.
- Different FrostPi sessions remain isolated. A request and response cannot migrate between sessions.

### Conversation visibility

The primary UI requirement is continued access to relevant conversation information while answering.

- The Question UI is docked within the FrostPi layout rather than covering the conversation with a full-surface modal.
- Its expanded body has a bounded height and internal scrolling, leaving a usable, independently scrollable conversation viewport.
- The panel can collapse to a compact request bar that preserves the pending/request-count indication and restores the form without losing its current in-memory answers.
- Expansion is for editing the form, not for hiding the conversation entirely.
- The layout remains usable at 280 px width and under VS Code light, dark, and high-contrast themes.

### Webview and process lifecycle

- The Extension Host owns the authoritative pending-request identity and payload while the Pi process is alive.
- A Webview-only remount reconstructs pending forms from Extension Host state.
- Unsubmitted answer drafts are Webview-local and may reset after a Webview-only remount. Persisting partial drafts in the Extension Host or on disk is out of scope.
- A Pi session process restart cancels the old request. No pending request or partial draft is restored into the replacement process.

### Existing `question` tools

- Project-local and user-global Pi extensions retain Pi's normal load-order priority over FrostPi's explicitly injected bundled extension.
- If another extension already supplies the effective `question` tool, FrostPi must not replace or disable that tool.
- The FrostPi form transport activates only for requests carrying the bundled extension's valid private marker and runtime token. An unrelated `input` request or another extension's `question` implementation continues through normal Extension UI handling.
- User documentation explains that third-party Question extensions can inspect `PI_INSIDE_FROSTPI` and skip their own registration when the user wants FrostPi's bundled tool to be effective.

## Private Protocol Contract

### Runtime ownership

Each enabled `SessionRuntime` owns:

- one random, unguessable runtime token;
- one private temporary request directory;
- the bundled extension launch argument;
- the environment variables needed by the bundled extension to locate the directory and token.

The directory and token are never shared across concurrently running sessions.

### Request publication

- Every tool invocation creates a random request identifier.
- The identifier is data, not a path. The Extension Host derives the file path inside its known runtime directory.
- The request document includes a protocol version, runtime token, request identifier, and complete normalized question input.
- The tool writes to a temporary sibling file and atomically renames it to the final request filename before calling `ctx.ui.input()`.
- The input title carries only the versioned FrostPi marker, runtime token, and request identifier needed to locate and authenticate the file.
- The Extension Host recognizes the marker before the generic Extension UI coordinator creates an ordinary input card.

### Validation and limits

The Extension Host rejects the private request when any of the following is invalid:

- marker syntax or protocol version;
- runtime token;
- request identifier;
- derived path containment;
- request file size;
- JSON syntax or schema;
- question count, option count, or text-size limits;
- disagreement between marker and file identity.

Rejected private requests are cancelled or failed visibly; they are never rendered as arbitrary extension-provided Webview markup.

Exact numeric limits remain an implementation decision and must be bounded, tested, and large enough for normal clarification questions.

### Response and cleanup

- Webview responses are schema-validated by the Extension Host.
- The Extension Host answers the original Pi Extension UI request id exactly once.
- Successful submission is encoded as a bounded, versioned JSON string in the standard `{ value }` response.
- Explicit cancellation uses the standard `{ cancelled: true }` response.
- The tool validates the returned JSON before constructing its tool result.
- The tool removes its request file in a `finally` path after submit, cancel, or abort.
- Runtime shutdown removes the entire temporary directory, covering stale files left by process failure.

## Implementation Decisions

- The private transport is owned by a dedicated Question bridge rather than embedded as ad hoc branches throughout generic Extension UI code.
- Generic `select`, `confirm`, `input`, and `editor` behavior remains unchanged for all unrecognized requests.
- The private request payload does not depend on correlating `tool_execution_start` with `extension_ui_request`; normal tool events remain authoritative only for conversation projection.
- Standard `extension_ui_response` remains the response transport because it already resolves the suspended Pi-side UI Promise and participates in session cancellation.
- No custom RPC event type is added to Pi or `@frostime/pi-rpc` solely for this feature.
- No temporary response file is used.
- Multiple pending requests are supported, so correctness must not rely on a single global current request.
- Question-form display state and answer drafts are local Webview state; pending request existence and request payload are Extension Host state.
- Durable protocol, lifecycle, or UI-boundary changes discovered during implementation must be reflected in the relevant project documentation before completion.

## Acceptance Criteria

### Automated checks

- With the feature disabled, Pi starts without the bundled Question extension and existing behavior is unchanged.
- With the feature enabled, a new or restarted Pi process exposes the bundled `question` tool when no earlier extension owns that name.
- A question invocation publishes an authenticated, bounded request file before the private Extension UI notification is handled.
- A valid private request becomes a typed pending Question request rather than a generic input card.
- Invalid markers, tokens, identifiers, paths, oversized files, and invalid schemas are rejected without reading outside the runtime directory.
- Submitting a complete single-question form resolves the tool with the selected or written answer only after Submit.
- Submitting a complete multi-question form returns every answer and the optional overall note.
- Submit remains unavailable while any question is unanswered.
- Answers and the overall note remain editable until Submit.
- Cancelling resolves the request once and does not leave the Pi turn blocked.
- Session abort, stop, close, and restart cancel pending requests and remove runtime temporary resources.
- Multiple pending requests in one session and requests in concurrent sessions receive only their matching responses.
- Existing ordinary Extension UI input/editor/select/confirm tests continue to pass.
- The relevant focused unit and component tests pass, followed by `pnpm check` and `pnpm build`.

### User checks

- In a Remote SSH workspace, the user can answer the bundled tool entirely inside FrostPi without opening an external terminal.
- While the form is expanded, the user can scroll and read the conversation independently.
- Collapsing the form exposes substantially more conversation space and restoring it preserves the current in-memory answers.
- At 280 px width, all questions, navigation, free-form answer editing, note editing, cancellation, and submission remain usable.
- VS Code light, dark, and high-contrast themes retain readable focus, selection, disabled, error, and completion states.

## Deferred

- A portable structured-form extension UI protocol for arbitrary Pi RPC or ACP clients.
- Rendering arbitrary extension-defined components or schemas in the FrostPi Webview.
- Persisting unsubmitted answer drafts across Pi process restart.
- Persisting unsubmitted answer drafts across a Webview-only remount.
- A dedicated Webview setting control when VS Code Settings already provides activation control.

## Glossary

- **Bundled Question extension**: The Pi extension shipped inside the FrostPi VSIX and injected into enabled Pi processes with an explicit extension launch argument.
- **Question request**: One invocation of the bundled `question` tool, containing one or more individual questions.
- **Individual question**: One prompt with predefined options and the ability to provide a written answer.
- **Overall note**: Optional text attached to the complete Question request rather than to one individual question.
- **Private marker**: A versioned, authenticated string placed in a standard Pi Extension UI input title so FrostPi can distinguish its bundled Question request from ordinary extension input requests.
- **Request identifier**: A random identifier assigned to one Question request and used to derive its request filename.
- **Runtime token**: A random secret unique to one running FrostPi Pi process, used to prevent accidental or unauthenticated private-request recognition.
- **Question bridge**: The Extension Host component that owns temporary request resources, validates private markers/files, projects pending Question requests, and returns responses to Pi.
- **Pending request**: A Question request whose Pi-side tool execution is waiting for submit or cancel.
- **Webview-only remount**: Recreation of the FrostPi browser UI while the owning Extension Host and Pi process remain alive.
- **Pi session process restart**: Termination and replacement of the Pi RPC child process for a FrostPi session.
