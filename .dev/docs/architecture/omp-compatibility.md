---
title: OMP Compatibility Architecture
description: Why FrostPi supports OMP through a Pi-centered contract, how the two compatibility layers divide work, and how future support is developed.
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-10-03
---

# OMP Compatibility Architecture

## From a second runtime to a bounded compatibility surface

Since v0.15.0, FrostPi has supported Oh My Pi (OMP) as a runtime on a limited basis. The product can launch OMP, hold ordinary conversations, resume OMP sessions, change model and thinking level, and use FrostPi's Question tool when it is enabled in settings. This does not mean FrostPi implements OMP's full RPC or TUI surface: session-tree navigation, fork, and runtime slash-command discovery and execution are not currently supported. FrostPi's Question tool remains available through its extension UI path; it is distinct from OMP's built-in `ask` tool.

The architectural problem is larger than making individual OMP commands work. FrostPi already has a product contract expressed in Pi's RPC vocabulary, and its session lifecycle, conversation projection, and UI depend on that contract. If each OMP difference is handled by adding an OMP condition to those consumers, compatibility knowledge spreads through the Pi path. Later work then has to rediscover which branches belong to which runtime, and a small protocol change can affect unrelated product behavior.

FrostPi therefore treats OMP as an implementation to adapt to its existing Pi-centered contract, not as a second product model. Compatibility has two layers because OMP differences have two different kinds: differences in how RPC messages are exchanged, and differences in what a runtime feature means to the product.

```text
OMP process
   │ runtime-specific frames and events
   ▼
RPC compatibility layer (`packages/pi-rpc`)
   │ Pi-shaped RPC contract + preserved protocol facts
   ▼
Product compatibility layer (VS Code Extension Host)
   │ FrostPi session and feature behavior
   ▼
Session lifecycle, conversation projection, and UI
```

The direction of this flow is the central maintenance rule: normalize a message at the RPC boundary only when doing so preserves its meaning; keep stateful or behaviorally different features above that boundary. Each difference has one owner, so the two layers do not translate or compensate for it twice.

## Layer one: adapt the RPC conversation

`packages/pi-rpc` owns the child process, JSONL framing, request correlation, chunk reassembly, startup negotiation, and runtime-specific RPC dialects. It has no VS Code dependency. `PiRpcConnection` performs transport mechanics; `RpcDialect` supplies runtime-specific startup and event behavior; `PiRpcApi` continues to expose Pi's vocabulary to product code. See [`packages/pi-rpc/SPEC.md`](../../../packages/pi-rpc/SPEC.md) for the transport contract and [`pi-rpc-compatibility.md`](../protocol/pi-rpc-compatibility.md) for cross-module rules.

This layer translates only **isomorphic** differences. A translation is isomorphic only when all four conditions hold:

1. The Pi-shaped name and payload can be derived from that message alone, without additional business state.
2. The mapping is complete and loses no information.
3. It introduces no new ordering, timing, or completion guarantee.
4. Failure and cancellation semantics remain the same.

For example, OMP's `session_settled` is normalized to Pi's `agent_settled` at the RPC boundary. The session code can then consume the same completion event without knowing which runtime emitted it. The earlier OMP `agent_end` is not interchangeable: it describes an agent attempt, not necessarily the end of the session's work.

Transport negotiation follows the same separation. OMP advertises supported RPC protocol versions in `ready`. If it advertises v2, FrostPi negotiates v2 and configures that connection's chunk decoder from the advertised physical and logical frame limits. Those limits are protocol parameters, not reasons to silently remain on v1. If v2 is not advertised, FrostPi uses v1; a failed negotiation is visible rather than silently downgraded. V1 can still fail on oversized responses, so supporting v1 does not guarantee that every history fits its single-line response format. The OMP dialect and assembler comments record the rationale at the implementation points.

Do not translate two operations merely because their names or return values look similar. OMP `branch` and Pi `fork`, for instance, may differ in commit boundary, session identity, abort behavior, or history replacement. Those differences require product-level analysis, not a method-name alias.

## Layer two: decide what the product supports

The VS Code Extension Host owns runtime facts and FrostPi feature policy. [`runtimeCompatibility.ts`](../../../apps/vscode/src/extension/configuration/runtimeCompatibility.ts) declares profile defaults, settings ownership, and product capabilities. [`SessionRuntime`](../../../apps/vscode/src/extension/sessions/SessionRuntime.ts) uses the selected profile to assemble the RPC dialect, extensions, and feature gates. Session lifecycle and conversation projection continue to consume the Pi-shaped contract.

Some OMP differences are not message translations. They depend on prior events, session state, UI interaction, or product-specific commit rules. When a requested feature falls into that category, implement it in an explicit OMP business-compatibility module selected at the runtime assembly point. Such a module should own the complete behavior and return explicit outcomes to the common lifecycle; do not scatter `if (isOmp)` branches through session and projection code. There is not currently a standalone OMP business-compatibility module because the initial supported surface needs profile facts and capability gates, not an empty adapter framework.

Capabilities control whether FrostPi offers or accepts a product operation; they are not inferred from whichever RPC events happen to arrive. An unavailable feature must be gated before it reaches the runtime, rather than exposed and then failing with `Unknown command`. FrostPi's local commands and runtime slash commands are separate paths; support for one must not be used as evidence that the other is supported.

OMP's built-in `ask` tool is not registered in ordinary `--mode rpc`. FrostPi's Question tool is instead injected as an extension and uses `ctx.ui.input()` through `extension_ui_request`. Keep these paths distinct: the Question tool remains part of the current integration, while OMP's separate `rpc-ui` / `set_ask_dialog` path is not implemented and has no runtime capability flag.

The child process remains authoritative for its session JSONL and runtime state. Compatibility must not silently create an empty replacement session, write or migrate OMP session files on FrostPi's behalf, or add a global execution lock. One `SessionRuntime` continues to own one child process.

## How to extend OMP support

Future agents should move from a requested user operation to the layer that owns its difference, then prove the complete behavior before exposing it:

1. **Define the product result.** Read this document, the relevant product SPECs, and the user's requested behavior. State what a user must be able to do and what counts as success. A historical change or an agent-written proposal is not user approval.
2. **Establish OMP facts.** Inspect the actual OMP RPC client, server, types, and relevant agent/tool implementation for the version being tested. Record the version and distinguish source evidence from runtime observations. Do not rely on another agent's summary or a machine-specific installation path.
3. **Assign the difference once.** Apply the four isomorphism conditions. If all pass, translate in the RPC dialect and preserve all required fields. If any fail, keep the runtime-specific facts available and implement the requested behavior in the product compatibility layer. If the semantics remain uncertain and could change the design, run the smallest discriminating experiment before choosing.
4. **Keep unsupported behavior closed until its contract is met.** Add a capability and gate at the product entry point while the behavior is incomplete. Discovery of a command is not proof it is safe to expose or that FrostPi can complete its lifecycle. For tree or fork work, verify identity, commit, abort, and history-reload behavior before enabling the UI.
5. **Test the user-visible contract.** Keep Pi regression tests. Add OMP fake-process tests for handshake, message shape, ordering, failure, and stateful sequences as relevant. Then test with the real OMP runtime. For resume, copy the session JSONL and its same-named artifact directory; never disrupt or edit an online session. RPC-level success alone does not prove the full Extension Host and UI flow.
6. **Update durable contracts with the implementation.** Update `packages/pi-rpc/SPEC.md` for transport or dialect behavior and every affected product SPEC for session/UI behavior. Update this architecture document only when the compatibility model, ownership boundary, supported surface, or maintenance workflow changes. Keep local algorithm details in code comments and tests.
