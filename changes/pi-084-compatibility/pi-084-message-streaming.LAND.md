---
title: Pi 0.84 Message Streaming Landing Shape
created: 2026-08-09T12:09:51+08:00
updated: 2026-08-09T12:52:21+08:00
status: proposed-for-review
spec: pi-084-message-streaming.SPEC.md
map: pi-084-message-streaming.MAP.md
---

# Change Shape

Pi assistant message events will continue to enter `ConversationProjection` unchanged. `ConversationProjection` will own one new `PiAssistantMessageAdapter` instance. The adapter's architectural role is version adaptation: it converts Pi 0.83 cumulative-message events and Pi 0.84 delta-only events into one FrostPi-internal representation. Its implementation assembles indexed deltas, but it owns no turn, persistence, item placement, tool execution, or Webview policy.

`ConversationProjection` will remain the place that decides what an adapted assistant message means in the current conversation. `ConversationItemStore` will remain the place that owns item location, live-to-persisted takeover, and real tool-call lookup. Shared model types will remain the Host/Webview data contract. The shared tool type will explicitly distinguish preparing and bound tools; Svelte will render that distinction without inspecting Pi events.

The change deliberately separates a tool activity's stable page identity from Pi's real `toolCall.id`. The page identity is derived from the assistant view message and `contentIndex`. Shared tool data will explicitly distinguish a preparing tool, which has raw arguments but no Pi tool ID, from a bound tool, which has the real ID/name/structured arguments. The Store registers an execution lookup only after the real ID exists.

# Core Code

```text
apps/vscode/src/
├── extension/
│   ├── conversation/
│   │   ├── PiAssistantMessageAdapter.ts                 create  +160–230
│   │   │   Version adapter with one active assistant-message state; validates event shape,
│   │   │   assembles indexed content, and exposes a version-independent internal result.
│   │   │
│   │   ├── ConversationProjection.ts                    modify  +80–120/-30–55
│   │   │   Own the adapter; convert adapted content into activities; use contentIndex-based
│   │   │   activity IDs; centralize live-message reset and finalization calls. Remove the
│   │   │   existing streaming message ID/key fields instead of creating parallel active state.
│   │   │   Existing turn, retry, error, abort, persisted-entry, and image policy stays here.
│   │   │
│   │   ├── ConversationItemStore.ts                     modify  +25–45/-10–20
│   │   │   Preserve one stable outer activity location while a preparing tool becomes bound;
│   │   │   register only real tool IDs for execution lookup; merge newly visible indexed
│   │   │   activities in order without removing same-turn notices. The Store remains unaware
│   │   │   of Pi event versions and delta types.
│   │   │
│   │   └── messageAssembler.ts                          modify  +2–6
│   │       Continue to own generic block/tool view helpers and construct explicitly bound
│   │       tool data. It must not acquire live protocol state.
│   │
│   └── sessions/
│       └── SessionRuntime.ts                            modify  +4–10/-4–8
│           On stop/failure, call one Projection operation that finalizes all current live state;
│           Runtime does not import or reset the adapter directly.
│
├── shared/model/
│   └── toolCallModel.ts                                 modify  +20–35/-2–6
│       Replace the single all-fields-required shape with a small discriminated union:
│       preparing tool data has raw arguments and no Pi tool ID; bound tool data has the existing
│       real ID/name/structured arguments. Common status and timing remain shared.
│
└── webview/features/conversation/
    └── ToolActivity.svelte                              modify  +25–45/-5–15
        Render the existing card from the explicit preparing/bound tool distinction. Preparing
        data shows the generic title and raw arguments; bound data shows the existing name,
        actions, structured input, and output. Keep component-local expansion state and scoped CSS.
```

Impact assessment:

- `ConversationProjection.ts` receives a moderate local rewrite of the live assistant path, not a class-wide refactor.
- `ConversationItemStore.ts` receives a narrow identity/order change; its ownership maps and persisted takeover model remain intact.
- The shared tool type becomes more explicit rather than adding placeholder values to fields that claim to contain real Pi identity.
- `SessionRuntime.ts` and Svelte receive localized lifecycle and rendering changes.
- `packages/pi-rpc` production code remains unchanged.

# Verification Code

```text
apps/vscode/test/
├── unit/
│   ├── PiAssistantMessageAdapter.test.ts                create  +180–280
│   │   Direct event-sequence tests for both Pi shapes, indexed content, malformed events,
│   │   authoritative end values, multiple tools, and reset behavior.
│   │
│   ├── ConversationProjection.test.ts                   modify  +170–260
│   │   Verify visible text/thinking/tool activities, stable activity IDs, final-message
│   │   replacement, retry, delayed live replay, and persisted takeover. Seed distinct partial
│   │   content before agent_settled, replaceEntries, completeTurn, a replacement message_start,
│   │   and post-message_end late updates to prove each boundary cannot leak state.
│   │
│   ├── ConversationItemStore.test.ts                    modify  +30–70
│   │   Verify preparing-to-bound tool replacement, execution lookup, ordered insertion, and
│   │   preservation of notices and execution state.
│   │
│   └── SessionRuntime.test.ts                            modify  +90–160
│       Use a real child-process/JSONL path to verify streaming projection, stop/failure
│       finalization, and stop/start restart isolation rather than testing only direct
│       Projection calls.
│
└── e2e/
    └── fake-pi.cjs                                      modify  +35–65
        Add a dedicated prompt behavior that emits a Pi 0.84 message_start, delta-only updates,
        tool binding, message_end, execution events, persistence, and agent_settled sequence.
```

No Svelte component test framework is introduced for this change. Stable component identity is protected by Projection/Store ID assertions, the fake-process path, and manual page checks from the SPEC.

# Contract Documentation

```text
docs/protocol/
└── pi-rpc-compatibility.md                               modify  +8–15
    Record shape-based 0.83/0.84 compatibility and the raw-transport boundary.

packages/pi-rpc/
└── SPEC.md                                               modify  +3–8
    Record that delta-only events are forwarded unchanged and assembly remains product policy.

apps/vscode/src/extension/
├── conversation/conversation-projection.SPEC.md         modify  +25–45
│   Record indexed live content, authority order, stable pending-tool identity, malformed-event
│   behavior, and reset/finalization boundaries.
└── sessions/session-lifecycle.SPEC.md                    modify  +5–12
    Record that stop/failure finalizes pending assistant/tool presentation state.

changes/pi-084-compatibility/
├── pi-084-message-streaming.SPEC.md                      update if reviewed shape changes behavior
├── pi-084-message-streaming.MAP.md                       append new navigation pointers after files exist
└── pi-084-message-streaming.LAND.md                      keep synchronized with architectural drift
```

# Dependency Changes

```text
Before

SessionRuntime
    └── ConversationProjection
        └── ConversationItemStore

After

SessionRuntime
    └── ConversationProjection
        ├── PiAssistantMessageAdapter
        │   └── understands Pi assistant event versions and contentIndex
        └── ConversationItemStore
            └── understands page ownership and real tool-call locations

ConversationProjection ──produces──► shared model ◄──renders── Webview
```

- `PiAssistantMessageAdapter` may depend on the open `RpcEvent` type and small record-reading helpers. It must not import `SessionRuntime`, `ConversationItemStore`, shared Webview models, or Svelte code.
- `ConversationProjection` is the only consumer of the adapter's internal result.
- `ConversationItemStore` continues to accept prepared `AgentActivityView` objects. It does not receive `contentIndex` deltas or protocol-version flags.
- Webview code continues to depend only on `shared/model`; no Pi RPC type crosses into browser code.

# Cross-File Rules

1. A valid complete assistant `event.message` replaces adapter content for that event. Its delta may inform legacy status but must not append content again.
2. Live and persisted assistant content must derive activity IDs from the Store-provided assistant view ID plus source content index. A tool's outer activity ID must not be derived from `toolCall.id`.
3. Preparing tool data has no Pi tool ID and is not registered in the Store's execution lookup. `toolcall_end` replaces its inner data with bound tool data at the same outer activity location, then registers the real ID.
4. The adapter owns the only active assistant protocol state. Projection derives placement input from each adapter result; the existing `#streamingMessageId` and `#streamingCorrelationKey` fields are removed rather than synchronized with adapter state.
5. The adapter returns current assistant content; Projection decides message status, turn placement, persisted authority, and whether a result is published.
6. Resetting adapter state must not silently remove an already displayed interrupted tool. Stop/failure first finalizes unresolved tools as cancelled, then clears only temporary assembly state.
7. Both normal full messages and assembled live messages must pass through the same content-index-aware activity construction rules, so persisted takeover cannot change page identity.
8. Unknown or malformed content deltas remain local ignored inputs. Transport framing/envelope failures retain their existing fatal behavior.
9. Tests must exercise every SPEC reset boundary, including replacement start, settle, complete turn, history replacement, stop/failure, restart, and late update after final message.
10. The fake-process test must reach `SessionRuntime` and the conversation view. A transport-only assertion is not sufficient compatibility evidence.

# Deliberate Non-Changes

- No Pi version probe, minimum-version check, feature negotiation, or version registry.
- No synthetic 0.83 RPC event emitted by Runtime or `packages/pi-rpc`.
- No fabricated value placed in a field that claims to be a real Pi tool ID.
- No generic event-reducer framework, plugin point, or multi-stream abstraction.
- No Webview-side parsing of raw arguments or Pi events.
- No throttling, batching, streaming-size cap, or unrelated conversation refactor.
- No new standalone pending-tool Svelte component.

# Drift Triggers

Stop and re-review this LAND before continuing if implementation requires any of the following:

- modifying `packages/pi-rpc` production event handling;
- placing adapter state in `SessionRuntime`, `ConversationItemStore`, or Svelte;
- rewriting tool execution IDs on incoming `tool_execution_*` events;
- assigning a fabricated Pi tool ID to preparing tool data;
- adding a second visible activity for pending tools;
- broadly rewriting `ConversationProjection` outside its live assistant and lifecycle-reset paths;
- introducing a new shared state manager, event bus, or generic protocol compatibility framework;
- materially exceeding the listed core-file impact or discovering that persisted takeover cannot preserve content-index activity identity.

# Review Checkpoint

This LAND fixes the top-level ownership and dependency direction. After approval, the next shaping pass should create the adapter's real type/signature skeleton and mark the exact Projection, Store, Runtime, shared-model, and Svelte insertion points. Full behavior implementation should wait until those contracts are reviewed.
