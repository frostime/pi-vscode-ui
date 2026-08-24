---
title: Session editor-tab projection — implementation shape
status: proposed
---

# Session editor-tab projection LAND

This LAND fixes the implementation structure for [`session-tab-projection.SPEC.md`](session-tab-projection.SPEC.md). The sidebar remains the sole Session-management surface. The change replaces the single-Webview host with one coordinator that owns shared services and multiple independent connections: one connection follows the sidebar selection, while each editor tab connection is pinned to one Session.

The chosen shape favors explicit ownership and stable meanings over the smallest initial diff. In particular, `activeSessionId` always means the sidebar selection; a Session Tab never reinterprets or mutates it merely to obtain data.

## Target Architecture

```text
SessionRegistry
  ├─ SessionRuntime × N
  ├─ activeSessionId                 sidebar selection only
  └─ full view for any sessionId
             │
             ▼
SessionWebviewCoordinator            shared composition and routing
  ├─ WebviewActionDispatcher         Host actions + surface authorization
  ├─ ComposerDraftCache              externalized draft ownership
  ├─ ComposerExternalEditor          one shared external editor
  ├─ Sidebar WebviewConnection       follows activeSessionId
  └─ SessionPanelManager
       ├─ Session A → WebviewConnection(A)
       └─ Session C → WebviewConnection(C)

Each WebviewConnection
  ├─ owns one Webview endpoint
  ├─ owns snapshot/delta/visibility state
  └─ owns one file-search cancellation scope
```

## Architecture Constraints

1. **Stable meaning over reuse by coincidence.** `activeSessionId` remains the sidebar selection everywhere. Bridge presentation data names the Session displayed by each connection separately.
2. **One owner per changing concern.** Registry owns Session lifecycle; PanelManager owns Session-to-panel mapping; Connection owns endpoint synchronization; DraftCache owns externalized Composer drafts; Dispatcher owns Host action policy.
3. **Dependency points toward Session abstractions.** Panel and Webview modules may query or command `SessionRegistry`; Registry must not import or know about VS Code panels, Webview connections, or Svelte surfaces.
4. **The Host enforces surface capabilities.** Hiding controls in Svelte is insufficient. A tab connection may act only on its pinned Session and may not invoke sidebar-only management actions.
5. **Webviews are disposable projections.** Conversation/runtime truth remains Host-owned. A connection that remounts or misses hidden updates recovers from a full snapshot rather than browser persistence.
6. **Compatibility is additive.** With no panels, the sidebar follows the same selection, command, persistence, and startup paths as before.
7. **Do not centralize unrelated browser state.** Only Composer text and images cross the sidebar/tab handoff; scroll, disclosure, expansion, and form drafts stay presentation-local.
8. **No sensitive observability.** Diagnostics may record surface kind, Session id, lifecycle transitions, and resync reasons, but never prompts, responses, image bytes, credentials, or unredacted proxy URLs.

## Decision-Bearing File Tree

Magnitudes are rough drift indicators, not line budgets.

### Extension Host

```text
apps/vscode/src/extension/
├── activate.ts
│   modify +15–30/-5–15 · moderate
│   Compose Registry, Coordinator, PanelManager, status bar, provider, and commands.
│
├── commands/registerCommands.ts
│   modify +20–40/-10–20 · moderate
│   Depend on Coordinator rather than the old Bridge; route editor-originated
│   file references through the destination-selection policy.
│
├── sessions/
│   ├── SessionRegistry.ts
│   │   modify +70–120/-25–50 · high-impact localized lifecycle change
│   │   Expose arbitrary Session views, retain previously externalized Provisional
│   │   Sessions, deliver Session-owned editor text without presentation policy,
│   │   and support source-sensitive Fork selection.
│   └── session-lifecycle.SPEC.md
│       modify ~10–20% · contract update
│       Record sidebar selection semantics, Provisional retention, and Fork origin behavior.
│
├── composer/ComposerExternalEditor.ts
│   preserve · ownership moves from Bridge to Coordinator
│   Keep one-at-a-time temp-editor mechanics; route results by Session id.
│
└── webview-host/
    ├── WebviewBridge.ts
    │   delete -367 · full replacement
    │   Its synchronization and dispatch responsibilities move to the modules below.
    │
    ├── SessionWebviewCoordinator.ts
    │   create +120–180 · new composition boundary
    │   Own shared Host services, Registry subscriptions, sidebar connection,
    │   panel coordination, global toasts, Composer routing, and destination selection.
    │
    ├── WebviewConnection.ts
    │   create +170–240 · new deep endpoint abstraction
    │   Own one Webview's ready/visible/dirty lifecycle, full snapshots, deltas,
    │   correlated posting, target resolution, and file-search cancellation scope.
    │
    ├── WebviewActionDispatcher.ts
    │   create +260–340 · mostly reorganized existing behavior
    │   Move the current action switch here; add surface capability checks and
    │   resolve Session-scoped actions from the connection context.
    │
    ├── SessionPanelManager.ts
    │   create +120–180 · new VS Code adapter
    │   Own sessionId→WebviewPanel uniqueness, create/reveal/title/dispose behavior,
    │   and closure when Registry removes the Session.
    │
    ├── ComposerDraftCache.ts
    │   create +140–220 · new transient-state owner
    │   Own externalized per-Session text, image backing storage, failure snapshots,
    │   cleanup, and sidebar↔tab handoff.
    │
    ├── PiViewProvider.ts
    │   modify +10–25/-10–20 · major responsibility rewiring, small file
    │   Keep sidebar reveal/focus policy; attach its Webview through Coordinator.
    │
    └── collectionDelta.ts
        preserve · dependency moves to WebviewConnection
        Remain the ordered collection-delta implementation.
```

### Shared Contracts

```text
apps/vscode/src/shared/
├── model/
│   ├── webviewPresentationModel.ts
│   │   create +45–80
│   │   Define sidebar/tab surface identity, displayed Session, true sidebar
│   │   activeSessionId, and sidebar placeholder state without semantic overloading.
│   └── composerDraftModel.ts
│       create +25–50
│       Define serializable draft/image views shared by Host and Webview.
│
└── bridge/
    ├── hostToWebview.ts
    │   modify ~35–50%
    │   Snapshot/delta messages carry explicit presentation state and draft replacement.
    ├── webviewToHost.ts
    │   modify +50–100/-0–20
    │   Add sidebar-only externalization and panel draft-update messages while keeping
    │   bounded schema validation.
    ├── bridgeVersion.ts
    │   modify 1 line
    │   Bump for the incompatible presentation contract.
    └── webview-bridge.SPEC.md
        modify ~25–40%
        Specify multiple connections, pinned authorization, visibility recovery,
        presentation snapshots, and Composer handoff ordering.
```

`WorkspaceViewModel.activeSession` remains available to Registry/status-bar code. Webview presentation contracts do not fake a pinned Session as that active Session; they expose a separate displayed-Session field.

### Svelte Webview

```text
apps/vscode/src/webview/
├── App.svelte
│   modify ~40–60%
│   Select sidebar or panel shell from Host-supplied surface identity.
│
├── shell/
│   ├── AppShell.svelte
│   │   delete -31 · replaced by explicitly named sidebar shell
│   ├── SidebarShell.svelte
│   │   create +35–60
│   │   Compose SessionHeader with either SessionInteraction or the externalized placeholder.
│   ├── PanelShell.svelte
│   │   create +30–60
│   │   Render only allowed conversation interaction and a restricted failure state.
│   └── SessionInteraction.svelte
│       create +30–50 · extracted shared composition
│       Compose Conversation, metrics, extension UI/widgets, and Composer once.
│
├── features/sessions/
│   ├── ExternalizedSessionView.svelte
│   │   create +40–80
│   │   Explain the externalized state and reveal the owning tab.
│   └── SessionHeader.svelte
│       modify +15–35/-0–10 · small
│       Add the sidebar-only “open in editor” action.
│
├── features/composer/
│   ├── Composer.svelte
│   │   modify +20–50/-5–20 · moderate
│   │   Connect panel draft changes/submission outcomes to the draft-sync client.
│   ├── composerDraftSync.ts
│   │   create +80–140
│   │   Synchronize text changes and image add/remove events without retransmitting
│   │   image bytes on every text edit; apply Host draft replacements without echo loops.
│   ├── composerDraftStore.svelte.ts
│   │   modify +10–25/-5–15 · small
│   │   Use the shared draft model and expose the mutation boundary used by sync.
│   └── frostPiCommands.ts
│       modify +5–15/-0–5 · small
│       Omit host-local Resume from panel command completion.
│
├── bridge/applyHostMessage.ts
│   modify ~40–60%
│   Reconcile explicit presentation snapshots/deltas and Host draft replacement.
│
├── state/sessionViewStore.svelte.ts
│   modify ~40–60%
│   Store presentation surface, sidebar active id, displayed Session, and sidebar placeholder state.
│
└── styles/
    ├── tokens.css
    └── composer.css
        modify ~5–15% each
        Generalize cross-tree shell/expanded-Composer layout; new component-private
        placeholder/panel chrome stays in scoped Svelte styles.
```

`OnboardingView.svelte` remains sidebar-oriented. Panel failure rendering must not reuse its Retry/Configure/Settings controls.

### Tests and Durable Documentation

```text
apps/vscode/test/unit/
├── SessionRegistry.test.ts                 modify + focused lifecycle/Fork cases
├── WebviewConnection.test.ts               create · snapshot/delta/hidden recovery isolation
├── WebviewActionDispatcher.test.ts         create · surface authorization and target routing
├── SessionPanelManager.test.ts             create · one-panel identity and asymmetric close
├── ComposerDraftCache.test.ts              create · handoff/failure/cleanup semantics
├── composerDraftSync.test.ts               create · text/image diff and echo suppression
├── webviewBridgeSchema.test.ts             modify · new bounded bridge messages
└── sessionShells.test.ts                   create · sidebar placeholder vs restricted panel

docs/
├── architecture/overview.md                modify small · Svelte Webview × N topology
├── feature-map.md                          modify small · new Host entry points
└── design/ui-spec.md                       modify small · sidebar authority and panel limits

apps/vscode/src/webview/features/composer/composer.SPEC.md
    modify · externalized draft ownership and non-transferred local state
```

Mechanical fixture/test files discovered during implementation may be added without updating LAND. A new core owner, reversed dependency, or second synchronization mechanism requires LAND review.

## Cross-Module Rules

- Coordinator constructs connections and supplies callbacks; a Connection never imports Coordinator or mutates Registry directly.
- Each Connection serializes outbound synchronization and advances its delta cache only after successful delivery. Hidden or failed delivery marks the connection dirty so its next visible/ready update is a full snapshot.
- Dispatcher receives an immutable surface context from its Connection. Client-supplied Session ids cannot expand that surface's authority.
- PanelManager owns VS Code panels but not Session state. Registry removal is observed downstream; panel disposal never calls Session close.
- DraftCache is presentation state in the Extension Host, not Session persistence. Registry and Pi RPC do not store Composer drafts.
- Panel draft mutations are sent immediately with monotonically increasing revisions; synchronization must not depend on a debounce flush during tab disposal. Host ignores stale revisions and retains the latest accepted draft across projection closure.
- Each Connection computes deltas only for its displayed Session. Full conversation collections are not broadcast to unrelated Webviews.
- File search cancellation is isolated per Connection; ComposerExternalEditor remains shared and one-at-a-time.
- Registry Fork accepts a result-selection policy rather than a Sidebar/Tab type: sidebar origin selects the Fork result; tab origin preserves sidebar selection.
- Externalization commits panel mapping, Provisional retention, and initial draft ownership as one Host operation. Failure or Session removal before commit disposes prepared resources and leaves the Session in its prior sidebar state.

## High-Impact Flows

```text
Externalize
Sidebar action → validate sidebar capability + Session existence
              → prepare draft and panel → revalidate Session
              → commit panel mapping + draft + Provisional retention
              → sidebar presentation becomes placeholder
Any pre-commit failure → dispose prepared resources → preserve prior sidebar state

Close tab
Panel dispose → remove panel mapping → keep Session + draft
              → refresh sidebar presentation

Close Session
Registry removal → Coordinator observes absence → PanelManager disposes panel
                 → DraftCache releases Session state

Runtime update
Registry change → Coordinator → each visible Connection reconciles its own target
Hidden Connection → mark dirty → full snapshot on visible/ready
```

## Migration Order

1. Add Registry view/retention/Fork-selection contracts and tests.
2. Split the old Bridge into Coordinator + Dispatcher + one Sidebar Connection while preserving sidebar behavior.
3. Introduce explicit presentation bridge contracts and update the existing Svelte path.
4. Add DraftCache and panel draft synchronization.
5. Add PanelManager, Panel Connections, Sidebar placeholder, and PanelShell.
6. Route editor-originated references and shared external-editor results through Coordinator.
7. Add visibility recovery, surface-authorization tests, durable SPEC updates, and full verification.

Each step must leave TypeScript valid. Step 2 is the compatibility checkpoint: if sidebar-only behavior changes before panels exist, stop and correct the split before proceeding.

## Drift Signals

Stop and review the shape if implementation introduces any of these:

- `SessionRegistry` imports Panel/Webview presentation code;
- pinned tabs are implemented by changing `activeSessionId`;
- a second independent Bridge stack is added beside the sidebar Bridge;
- every panel constructs its own external editor or global Registry/toast subscriptions;
- panel capability restrictions exist only as hidden Svelte controls;
- all Session conversations are broadcast to every Webview;
- draft, tab-layout, or presentation-state persistence is added;
- the old `WebviewBridge` remains as another coordination owner after migration.

## Verification Intent

Tests should protect five contracts rather than implementation call order:

1. sidebar-only compatibility;
2. per-connection Session and delta isolation;
3. Host-enforced panel capability boundaries;
4. asymmetric lifecycle (`close tab ≠ close Session`, `close Session ⇒ close tab`);
5. lossless Composer text/image handoff with bounded cleanup.
