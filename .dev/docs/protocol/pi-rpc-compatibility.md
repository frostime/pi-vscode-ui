---
title: Pi RPC Compatibility
description: Cross-module policy for Pi native RPC surface, authority, failures, and compatibility evidence.
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-10-03
---

# Pi RPC Compatibility

FrostPi targets the current documented Pi-compatible RPC mode and launches the selected runtime with `--mode rpc`. The selected RPC dialect owns runtime-specific handshake, request/response vocabulary, and isomorphic events, plus the explicitly bounded OMP command-discovery projection; the VS Code runtime contract owns product capability declarations and stateful compatibility. FrostPi does not bundle or pin Pi, require a patched runtime, target a generic backend or ACP compatibility layer, or claim complete support for runtime-specific features of an alternate executable.

## Required surface

- Startup requires `get_state`; product features use prompt/abort, compaction, entries, fork, commands, models, thinking level, naming, statistics, and extension UI responses.
- The OMP dialect supports RPC v1 and v2: `ready` advertising v2 triggers negotiation before `get_state`; the declared physical and logical ceilings configure that connection's chunk decoder rather than gating negotiation. Otherwise startup proceeds in v1. Failed negotiation is a visible startup failure. V1 retains OMP's one-line response limit, so large history loads may fail with the runtime's transport-limit error; v2 reassembles chunked responses.
- Runtime projection consumes documented agent, message, tool, compaction, and extension UI events. Unknown additive events or fields are accepted unless a required invariant becomes impossible.
- Cache-miss projection derives Pi TUI-compatible notices from documented assistant `provider`, `model`, `timestamp`, and `usage` fields on `message_end` and session entries, plus full Model cost data from `get_available_models`. RPC does not carry Pi TUI's rendered warning text. Missing or malformed diagnostic fields are ignored locally without weakening generic event forwarding.
- Pi 0.83 cumulative `message_update.message` and Pi 0.84 delta-only `message_update.assistantMessageEvent` are both supported by shape. Delta assembly is extension conversation policy; the transport forwards either form unchanged.
- Malformed JSONL, invalid envelopes, stdin/stdout failure, startup timeout, and unexpected process exit remain visible connection failures. Malformed assistant content deltas are ignored locally and do not weaken transport failures.

Private adapters for capability gaps such as session-tree navigation, fork, and the Question tool remain product modules above the normalized transport. Availability is capability-based; missing capability is visible and never inferred away by a silent fallback. The FrostPi Question tool uses extension `input` UI and remains distinct from OMP's runtime `ask` UI.

## Executable and authority rules

Configured arguments follow `--mode rpc`, and restored sessions add `--session <path>`. Configured `.js`, `.mjs`, and `.cjs` entry points run with environment `node`; native executables run directly. `apps/vscode/src/extension/configuration/configuredPiInvocation.ts` owns invocation shape, while `packages/pi-rpc/src/process/resolvePiExecutable.ts` owns PATH/common-global resolution.

The selected child runtime remains authoritative for session JSONL, model/session state, migration, and extension lifecycle. The `oh-my-pi` profile also supports discovered Markdown commands and skills, but not the full OMP command surface or separate `prompts/` templates. OMP runtime settings remain runtime-owned. Skill presentation normalization never rewrites persisted custom entries. After model or thinking changes, the next `get_state` result wins if the child runtime clamps the selection.

The selected `get_entries` parent chain and reported leaf are transcript authority, including pre-compaction entries. `get_messages` is current LLM context and must not hydrate conversation history.

A missing or incompatible restored session fails visibly; FrostPi never substitutes a new empty session under the same UI identity.

## Change evidence

For OMP-specific ownership decisions, capability expansion, and preserving maintenance knowledge before change archival, follow [OMP compatibility maintenance](../architecture/omp-compatibility.md).

Compatibility changes require captured fixtures or fake-process tests, updates to `packages/pi-rpc/SPEC.md`, and updates to every affected product SPEC.
