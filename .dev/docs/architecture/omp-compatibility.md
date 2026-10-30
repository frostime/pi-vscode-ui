---
title: OMP Compatibility Architecture
description: Why Oh My Pi support is split into transport and product compatibility layers, what the bounded surface covers, and how to add support safely.
scope:
  - /packages/pi-rpc/**
  - /apps/pi-client/**
updated: 2026-10-24
---

# OMP Compatibility Architecture

FrostPi runs Oh My Pi (OMP) as an alternate runtime behind its existing Pi-centered product contract. The installed OMP runs unchanged; a patched distribution or an upstream change is not a prerequisite. [Pi RPC compatibility](../protocol/pi-rpc-compatibility.md) defines the transport ownership and failure rules this document builds on.

## Why two layers exist

FrostPi's session lifecycle, conversation projection and UI are written in Pi's RPC vocabulary, and both products share them. If every OMP difference were handled by adding an OMP condition inside those consumers, knowledge about which runtime owns which behavior would spread through the Pi path. Later work would have to rediscover the branches, and a small protocol change could alter behavior for the other runtime. OMP is not a Pi clone: its RPC mode has its own handshake, framing and events, and some operations with Pi-like names mean something else.

The differences fall into two kinds, and they need different treatment. A difference in how messages are exchanged can be translated where that exchange happens. A difference in what an operation means to the product depends on session state, earlier events, UI interaction or commit rules, so it cannot be decided from a single message. Compatibility therefore has two layers:

```text
OMP process
   │ runtime-specific frames and events
   ▼
RPC compatibility layer (packages/pi-rpc)
   │ Pi-shaped RPC contract, plus preserved facts that have no isomorphic form
   ▼
Product compatibility layer (apps/pi-client core, running in the Host)
   │ FrostPi session and feature behavior
   ▼
Session lifecycle, conversation projection and UI
```

This flow implies the maintenance rule. A difference is normalized at the RPC boundary only when normalization preserves its meaning; otherwise the runtime-specific facts remain available and the product layer implements the behavior. Each difference gets one owner. Two translations of the same difference hide each other, and the product can no longer tell what the runtime actually reported.

This is not a plugin or adapter framework. OMP is one declared profile with a bounded surface, not evidence that FrostPi should grow a general runtime SDK.

## The bounded supported surface

FrostPi supports launching the installed `omp` with `--mode rpc`, ordinary conversation and tool calls, model and thinking-level changes, discovery and resume of OMP sessions, discovered Markdown command files and skills, and FrostPi's Question tool when settings enable it.

It does not support OMP's full RPC or TUI surface, session-tree navigation, fork, builtin/extension/custom/MCP runtime commands, or separate `prompts/` templates. OMP's built-in `ask` tool is not registered in the ordinary `--mode rpc` launch, and FrostPi does not implement the separate `rpc-ui` / `set_ask_dialog` path. FrostPi's Question tool is a different mechanism: it is injected as an extension and answers through `extension_ui_request`. Neither tool's availability says anything about the other.

This list is the support boundary, and capability flags do not replace it. `apps/pi-client/src/core/configuration/runtimeCompatibility.ts` declares the profile defaults and the product capabilities that gate operations FrostPi implements; a flag does not prove the runtime supports the feature behind it, and adding one does not extend support. Discovering an OMP command likewise proves only that the runtime can list it, not that FrostPi can complete its lifecycle.

## Layer one: the RPC conversation

`packages/pi-rpc` owns the child process, JSONL framing, request correlation, reassembly, startup negotiation and the selected dialect. `PiRpcConnection` performs transport work, `RpcDialect` supplies startup and event behavior, and `PiRpcApi` keeps exposing Pi's vocabulary to product code. The transport contract is [`packages/pi-rpc/SPEC.md`](../../../packages/pi-rpc/SPEC.md).

A translation belongs here only when it is isomorphic, which requires all four conditions:

1. The Pi-shaped name and payload follow from that message alone, without additional business state.
2. The mapping is complete and loses no information.
3. It adds no ordering, timing or completion guarantee.
4. Failure and cancellation semantics are unchanged.

OMP `session_settled` → `agent_settled` satisfies all four. It carries exactly the fact the shared lifecycle needs, so session code consumes one completion event without knowing which runtime emitted it. OMP's `agent_end` looks similar and fails the test: it marks the end of an agent attempt, not necessarily the end of the session's work. Because the third condition covers completion, mapping `agent_end` onto the same event would move the completion boundary and let the UI declare a turn finished while queued work remains.

OMP `branch` and Pi `fork` fail the same test outside events. They may differ in commit boundary, session identity, abort behavior and whether history is replaced, so aliasing the matching name would promise a product operation FrostPi has not implemented. Those differences must be established and tested at the product level, not inferred from method names or response shapes.

The same reasoning leaves OMP skill messages and `prompt_result` unchanged on the wire. Their presentation, correlation and completion interpretation depend on session state and on what FrostPi already told the user, which the transport does not have.

Command discovery is the one deliberate projection. `get_commands` is sent as `get_available_commands`, and only Markdown file commands and skills are returned. Names that OMP's own parser would route to a builtin, another handler or skill syntax are excluded using the complete discovery response; that exclusion is why the projection needs the whole list rather than one descriptor at a time. Live updates use the same projection. It is stateless: it decides what FrostPi can discover, not what it may execute. Submission authorization and lifecycle state remain in the Host.

Protocol version selection belongs to the transport; using v1 or v2 creates no product capability. A failed negotiation fails startup rather than silently downgrading, and supporting v1 does not promise that every history loads: v1 responses are single-line, so an oversized payload remains a visible command error.

## Layer two: the product behavior

Whatever fails the isomorphism test stays visible to the product layer and is implemented in an explicit OMP module selected at runtime assembly. [`OmpPromptCompatibility.ts`](../../../apps/pi-client/src/core/sessions/OmpPromptCompatibility.ts) is the current module; `SessionRuntime` creates it only for the `oh-my-pi` profile. The module owns the complete behavior and returns explicit outcomes to the shared lifecycle. Do not scatter runtime-identity conditionals through session and projection code, and do not let the transport learn about queued prompts, turn status or UI state to compensate.

The module owns three decisions the transport cannot make: whether a discovered command may be submitted, how a runtime skill invocation is presented, and when a prompt result completes the session. Admission is a product decision because discovery is not authorization. Presentation must show the user's original invocation while leaving the persisted entry and OMP's persistence authority intact. Completion must follow OMP's explicit session-settled signal, because a prompt ending is not necessarily a session ending. Command admission and visible invocation rules are in the [Composer contract](../../../apps/pi-client/src/ui/features/composer/composer.SPEC.md). Session completion and persisted/live identity follow the [session lifecycle](../../../apps/pi-client/src/host/session-lifecycle.SPEC.md) and [conversation projection](../../../apps/pi-client/src/core/conversation/conversation-projection.SPEC.md) contracts; request correlation stays local to `OmpPromptCompatibility.ts`.

The module's checks are compatibility rules for a trusted runtime, not a security boundary or a lock against concurrent runtime changes.

The child process remains authoritative for its session JSONL and runtime state. Compatibility must not create an empty replacement session, write or migrate OMP session files on FrostPi's behalf, or add a global execution lock; one `SessionRuntime` owns one child process.

## Adding support

Move from the requested user operation to the layer that owns its difference, then prove the whole behavior before exposing it.

1. **Define the product result.** State what a user must be able to do, what success looks like, and which product SPEC owns it. A historical change record or an Agent-written proposal is not user approval.
2. **Establish OMP facts for the version FrostPi launches.** Inspect that version's RPC client, server, types and relevant implementation, and record the version. Distinguish source reading from runtime observation; another agent's summary or a machine-specific install path is not evidence.
3. **Assign the difference once.** Apply the four isomorphism conditions. If all hold, translate in the dialect and preserve every required field. If any fail, keep the runtime facts and implement the behavior in the product compatibility layer. If the semantics could change the design and are still uncertain, run the smallest discriminating experiment before choosing.
4. **Keep the surface closed until its contract is met.** Add the capability and gate it at the product entry point while behavior is incomplete. Discovery is not permission to expose, and RPC success is not proof that the user-visible operation completes. For tree or fork work, verify identity, commit, abort and history reload before enabling the UI.
5. **Test the user-visible contract.** Keep Pi regression tests, add OMP fake-process tests for handshake, message shape, ordering, failure and stateful sequences, then test the installed OMP runtime. For resume, copy the session JSONL and its same-named artifact directory; never disturb or edit an online session. RPC-level success does not prove the Extension Host or UI flow. Classify what each check establishes with [evidence boundaries](../testing.md#evidence-boundaries).
6. **Update the contracts with the implementation.** Update `packages/pi-rpc/SPEC.md` or a product SPEC only when the contract it owns changes; implementation-only compatibility fixes do not require mechanical SPEC edits. Update this document only when the compatibility model, layer ownership, supported surface or maintenance workflow changes. Local algorithm details stay in code comments and tests.
