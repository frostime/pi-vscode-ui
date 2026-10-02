---
title: Pi RPC Compatibility
description: Cross-module policy for Pi native RPC surface, authority, failures, and compatibility evidence.
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-09-15
---

# Pi RPC Compatibility

FrostPi targets the current documented Pi-compatible RPC mode and launches the selected runtime with `--mode rpc`. The selected RPC dialect owns runtime-specific handshake and isomorphic event vocabulary; the VS Code runtime contract owns product capability declarations. FrostPi does not bundle or pin Pi, does not target a generic backend or ACP compatibility layer, and does not claim complete support for runtime-specific features of an alternate executable.

## Required surface

- Startup requires `get_state`; product features use prompt/abort, compaction, entries, fork, commands, models, thinking level, naming, statistics, and extension UI responses.
- Runtime projection consumes documented agent, message, tool, compaction, and extension UI events. Unknown additive events or fields are accepted unless a required invariant becomes impossible.
- Cache-miss projection derives Pi TUI-compatible notices from documented assistant `provider`, `model`, `timestamp`, and `usage` fields on `message_end` and session entries, plus full Model cost data from `get_available_models`. RPC does not carry Pi TUI's rendered warning text. Missing or malformed diagnostic fields are ignored locally without weakening generic event forwarding.
- Pi 0.83 cumulative `message_update.message` and Pi 0.84 delta-only `message_update.assistantMessageEvent` are both supported by shape. Delta assembly is extension conversation policy; the transport forwards either form unchanged.
- Malformed JSONL, invalid envelopes, stdin/stdout failure, startup timeout, and unexpected process exit remain visible connection failures. Malformed assistant content deltas are ignored locally and do not weaken transport failures.

Private adapters for capability gaps such as session-tree navigation, fork, and the Question tool remain product modules above the normalized transport. Availability is capability-based; missing capability is visible and never inferred away by a silent fallback. The FrostPi Question tool uses extension `input` UI and remains distinct from OMP's runtime `ask` UI.

## Executable and authority rules

Configured arguments follow `--mode rpc`, and restored sessions add `--session <path>`. Configured `.js`, `.mjs`, and `.cjs` entry points run with environment `node`; native executables run directly. `apps/vscode/src/extension/configuration/configuredPiInvocation.ts` owns invocation shape, while `packages/pi-rpc/src/process/resolvePiExecutable.ts` owns PATH/common-global resolution.

The selected child runtime remains authoritative for session JSONL, model/session state, migration, and extension lifecycle. The `oh-my-pi` compatibility profile is limited to FrostPi's launch, RPC, session discovery, and resume surface; its runtime-specific settings and features remain outside this contract. After model or thinking changes, the next `get_state` result wins if the child runtime clamps the selection.

The selected `get_entries` parent chain and reported leaf are transcript authority, including pre-compaction entries. `get_messages` is current LLM context and must not hydrate conversation history.

A missing or incompatible restored session fails visibly; FrostPi never substitutes a new empty session under the same UI identity.

## Change evidence

Compatibility changes require captured fixtures or fake-process tests, updates to `packages/pi-rpc/SPEC.md`, and updates to every affected product SPEC.
