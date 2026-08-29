---
title: Session editor-tab projection
description: Allow selected FrostPi sessions to be displayed concurrently in restricted VS Code editor tabs while the sidebar remains the sole session control center.
---

# Session editor-tab projection

## Problem Statement

FrostPi can run multiple Pi sessions concurrently, but it currently has one sidebar Webview and can display only the sidebar-selected session. Users must switch the sidebar selection to inspect another session, so they cannot keep multiple running conversations visible at the same time.

The change must allow a session to be shown in a VS Code editor tab, including in split editor groups, without making editor tabs an alternative session-management center. The sidebar remains authoritative for the session collection and keeps its current behavior when no session is opened in a tab.

Success means that multiple session conversations can be viewed and operated concurrently, UI placement does not control Pi process lifetime, and existing sidebar-only workflows remain compatible.

## Terminology

- **Session**: one FrostPi `SessionRuntime` and its Pi process/state. The Session is the logical entity; a sidebar or editor tab is only a presentation of it.
- **Sidebar-selected Session**: the Session identified by `activeSessionId`, which means the Session selected in the FrostPi sidebar.
- **Externalized Session**: a Session whose conversation UI is currently projected into a VS Code editor tab. It remains present in the sidebar Session list.
- **Session Tab**: the restricted editor-tab projection of one externalized Session.
- **Provisional Session**: a normal newly created FrostPi Session that has not yet accepted its first non-empty prompt and has not been renamed, so FrostPi has not persisted it yet.
- **Ephemeral Session**: Pi's official `--no-session` mode. It is never persisted and cannot be reconstructed after its Pi process or Extension Host ends.

## Approach

Keep the sidebar as the only Session control center and add editor tabs as subordinate, fixed Session projections.

The existing sidebar selection model remains intact. A Session Tab obtains a full view of its pinned Session without activating or switching the sidebar. The tab reuses the existing conversation and Composer feature components inside a restricted shell that omits Session collection and lifecycle controls.

Each Session Tab is a newly mounted WebviewPanel synchronized from the same SessionRuntime. Host-owned transient Composer storage carries unsent text and images between the sidebar and tab.

## Design Reference

[`session-tab-projection.PROTOTYPE.svg`](session-tab-projection.PROTOTYPE.svg) illustrates the ownership, placement, and lifecycle relationships specified here. Its colors, dimensions, copy, and control arrangement are not a visual specification.

## Behavior Contract

### Sidebar authority and compatibility

- The FrostPi sidebar remains the sole Session-management surface for New, Resume, Temporary Mode, selection, rename, restart, Close Session, externalization, proxy/executable configuration, and diagnostics. A successful Fork creates and opens its result as specified under Fork behavior.
- `activeSessionId` continues to select the Session shown by the sidebar and to support existing sidebar-oriented status, persistence, restoration, and command behavior.
- Focusing or interacting with a Session Tab does not change `activeSessionId` or the sidebar selection.
- With no Session Tabs open, FrostPi's observable sidebar behavior remains unchanged.
- Existing VS Code command identifiers, user keybindings, and sidebar-oriented command behavior remain unchanged.
- Pi RPC, Pi processes, bundled Pi extensions, and third-party Pi extensions do not receive or observe sidebar selection or tab-placement state.

### Opening and representing a Session Tab

- The sidebar provides the action that opens a Session in an editor tab.
- One Session can have at most one Session Tab. Repeating the action reveals the existing tab instead of creating a duplicate.
- The Session remains in the sidebar Session list while its tab exists.
- When the sidebar-selected Session is externalized, the sidebar retains its Session header and navigation controls but replaces the conversation/Composer region with a placeholder explaining that the Session is displayed in an editor tab. The placeholder can reveal the corresponding tab.
- The user may select another Session in the sidebar while any number of Session Tabs remain open.
- Multiple Session Tabs may be visible concurrently through VS Code split editor groups.

### Session Tab capabilities

A Session Tab exposes these conversation capabilities, subject to the Session-specific limitations below:

- conversation rendering and live updates;
- Composer text, image attachments, send, Steer/Queue, and aborting the current run;
- model and thinking-level selection;
- Question and supported extension UI responses;
- file links, referenced locations, and diffs;
- `/editor`, compaction, Fork, and supported session-tree conversation operations;
- Session metrics and Session-specific runtime state needed to operate the conversation.

A Session Tab does not provide:

- the Session list or Session switching;
- New, Resume, or Temporary Mode;
- the host-local `/resume` command;
- rename, Close Session, restart, proxy/executable configuration, diagnostics, or other Session collection/lifecycle administration.

If `/resume` is explicitly entered in a Session Tab, FrostPi does not pass it through to Pi and directs the user to the sidebar.

### Tab and Session lifecycle

- Closing a Session Tab removes only that projection. It does not stop, abort, close, or delete the Session, even while Pi is running or waiting for input.
- Closing a tab does not force the sidebar to change selection or take focus.
- If the sidebar is currently showing that externalized Session, closing the tab restores its conversation UI in place. Otherwise, the Session becomes normally selectable in the sidebar list.
- After `SessionRegistry` removes a Session for any reason, the mapped Session Tab closes and the deleted Session does not regain sidebar display state. Sidebar-initiated close removes the Session before closing its tab.
- Hiding, covering, or moving a Session Tab does not affect its SessionRuntime or Pi process.

### Provisional and Ephemeral Sessions

- Both Provisional and Ephemeral Sessions may be opened in Session Tabs.
- Opening a Provisional Session in a Session Tab marks it for retention for the rest of its provisional lifetime. Sidebar selection, New/Resume, and tab closure do not discard it. Its first non-empty prompt or rename commits it; otherwise it remains until explicit Session removal or Extension Host exit.
- A Provisional Session that has never had a Session Tab keeps the existing switch-discard behavior.
- Ephemeral Sessions retain all existing limitations: they are never persisted, cannot restart after their process stops, do not support Fork, and disappear when the Extension Host exits. These limitations do not otherwise restrict tab projection.

### Composer handoff

- The shared per-Session draft consists only of unsent Composer text and image attachments.
- The Host cache is authoritative during handoff. A newly mounted presentation initializes from the latest cached draft; drafts are replaced, never merged.
- Draft edits replace the cached draft. Submission clears the current draft while retaining its failure snapshot; success discards that snapshot, while failure restores it only if no newer draft exists. Tab closure preserves the current draft. Session removal and extension disposal release all cached draft state.
- Cache storage remains outside the user's workspace, is not added to workspace/session persistence, and does not survive Extension Host restart.
- Conversation and runtime state come from the authoritative Session view.
- Scroll position, disclosure state, Composer expansion state, and partially entered Question/extension-form answers are local to each Webview presentation and are not transferred between sidebar and tab.

### Fork behavior

- Fork targets the Session whose presentation initiated it.
- A Fork initiated from the sidebar preserves the existing behavior: the result becomes the sidebar-selected Session.
- A Fork initiated from a Session Tab leaves `activeSessionId` unchanged. The source Session remains present and its tab stays bound to that source identity; the distinct Fork result opens in a new Session Tab and receives focus.

### Editor-originated file references

FrostPi's editor-context commands can insert only a path/line reference, never file contents.

- An action originating inside a Session presentation targets the Session displayed by that presentation.
- An editor-context action has no inherent Session target.
- Candidate targets are the sidebar-selected Session and all open Session Tabs, deduplicated by Session identity.
- With no candidates, FrostPi reveals the sidebar and inserts nothing.
- If there is one candidate, FrostPi inserts the reference directly into that Session's Composer.
- If there are multiple candidates, FrostPi asks the user to select the destination Session. It does not infer the target from editor-column adjacency or silently prefer the sidebar.
- Selecting an externalized Session writes to its Composer cache, reveals its tab, and focuses its Composer.
- Selecting a Session whose Composer is in the sidebar reveals and focuses the sidebar Composer.
- Routing an editor-originated reference never changes the sidebar `activeSessionId` merely because a Session Tab was selected as the destination.

### Window reload and restoration

- Session Tabs are not restored across VS Code window reload or workspace reopen.
- Restorable Sessions continue to appear through the existing sidebar restoration behavior and may be externalized again manually.
- Ephemeral Sessions continue to disappear when the Extension Host exits.
- When an existing Session Tab Webview is recreated or becomes visible after missing updates, it receives a fresh authoritative Session snapshot before further deltas.

## Implementation Decisions

- `SessionRegistry` remains the owner of SessionRuntime collection and sidebar selection.
- The existing active-session snapshot remains the sidebar projection. A separate per-Session full-view capability supplies Session Tabs without activating the sidebar.
- A Host-side panel owner maintains the one-to-one mapping between Session identity and WebviewPanel and owns panel reveal/disposal behavior.
- Webview synchronization is per presentation. The sidebar follows `activeSessionId`; each panel connection is pinned to one Session identity and maintains its own snapshot/delta state.
- Session Tab focus is presentation-only and never calls the sidebar activation operation.
- Host actions from a Session Tab are authorized and routed using the pinned Session identity. File search, relative-location resolution, Composer delivery, Fork, and tree operations use that identity without switching the sidebar.
- Shared conversation, Composer, Question/extension UI, model, thinking, and metrics components are reused. A dedicated restricted panel shell owns the capability difference from the sidebar shell.
- The Host, not either Webview instance, owns Composer handoff state while a Session is externalized.
- Externalization state is in memory only; no WebviewPanel serializer or persisted panel layout is introduced.

## Out of Scope

- Making sidebar and Session Tabs interchangeable or equal Session-management surfaces.
- Removing or renaming existing VS Code command identifiers.
- Changing Pi RPC, Pi session files, Pi process ownership, or third-party extension contracts.
- Final visual styling and copy beyond the hierarchy and behavior defined here.

## Acceptance Criteria

### Automated behavior checks

- Existing sidebar-focused tests continue to pass with no Session Tabs open.
- Opening a Session Tab does not change the registry's sidebar-selected Session.
- Opening the same Session twice creates one panel and reveals it on the second request.
- Full snapshots and subsequent conversation deltas for two different Session Tabs remain isolated by Session identity.
- A hidden/recreated panel resynchronizes from a full authoritative snapshot and does not miss intervening Session updates.
- Closing a panel removes only its externalized mapping; the SessionRuntime remains present and a running turn continues.
- Removing a Session from the registry disposes its panel exactly once.
- A panel closed because its Session was removed does not recreate sidebar display state for that Session.
- Once a Provisional Session has had a Session Tab, sidebar switching and tab closure do not discard it; a Provisional Session that has never had a tab keeps the existing switch-discard behavior.
- Ephemeral Session projection does not add persistence, restart, or Fork capability.
- Composer text and image attachments survive sidebar-to-tab and tab-to-sidebar handoff without duplication or loss.
- A non-sidebar-selected Session Tab can perform its allowed conversation actions without changing sidebar selection.
- Fork from the sidebar selects the result in the sidebar; Fork from a Session Tab leaves sidebar selection unchanged, keeps the source tab bound to the original Session, and opens the result in a distinct tab.
- New/Resume and Session-management actions are absent from the panel shell; `/resume` from a panel is rejected locally with sidebar guidance.
- Closing a Session through the sidebar automatically closes its Session Tab.
- Editor file/selection reference insertion routes directly with one candidate and presents a destination picker with multiple distinct candidate Sessions.
- Selecting a Session Tab as a reference destination reveals/focuses that tab without changing sidebar selection.
- Bridge validation continues to reject malformed, oversized, incompatible, or cross-Session messages without performing a Host action.

### Repository verification

- Relevant extension, bridge, registry, panel lifecycle, Composer handoff, and Webview component tests pass.
- `pnpm check` passes.
- `pnpm build` passes.

### User verification

- With Session A externalized and Session B displayed in the sidebar, both conversations remain independently usable and can run concurrently.
- With Sessions A and C open in separate split editor groups while Session B remains in the sidebar, all three conversations render live updates and accept their allowed actions without changing sidebar selection.
- With a source file and Session A shown in split editor columns while Session B is in the sidebar, the file-reference command asks whether A or B is the destination.
- Closing Session A's editor tab returns A to sidebar display without interrupting its running turn.
- Closing Session A from the sidebar removes its editor tab and Session entry.
- The sidebar exposes every Session-management control listed in this specification, and the Session Tab exposes none of them.
