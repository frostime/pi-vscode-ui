---
title: Pi RPC Compatibility
description: Cross-module policy for Pi native RPC surface, authority, failures, and compatibility evidence.
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-07-28
---

# Pi RPC Compatibility

FrostPi targets the current documented Pi native RPC mode and launches `pi --mode rpc`. It does not bundle or pin Pi and does not target a generic backend or ACP compatibility layer.

## Required surface

- Startup requires `get_state`; product features use prompt/abort, compaction, entries, fork, commands, models, thinking level, naming, statistics, and extension UI responses.
- Runtime projection consumes documented agent, message, tool, compaction, and extension UI events. Unknown additive events or fields are accepted unless a required invariant becomes impossible.
- Malformed JSONL, invalid envelopes, stdin/stdout failure, startup timeout, and unexpected process exit remain visible connection failures.

Private adapters for capability gaps such as session-tree navigation and the Question tool remain product modules above the generic transport. Availability is capability-based; missing capability is visible and never inferred away by a silent fallback.

## Executable and authority rules

Configured arguments follow `--mode rpc`, and restored sessions add `--session <path>`. Configured `.js`, `.mjs`, and `.cjs` entry points run with environment `node`; native executables run directly. `apps/vscode/src/extension/configuration/configuredPiInvocation.ts` owns invocation shape, while `packages/pi-rpc/src/process/resolvePiExecutable.ts` owns PATH/common-global resolution.

Pi remains authoritative for session JSONL, model/session state, migration, and extension lifecycle. After model or thinking changes, the next `get_state` result wins if Pi clamps the selection.

The selected `get_entries` parent chain and reported leaf are transcript authority, including pre-compaction entries. `get_messages` is current LLM context and must not hydrate conversation history.

A missing or incompatible restored session fails visibly; FrostPi never substitutes a new empty session under the same UI identity.

## Change evidence

Compatibility changes require captured fixtures or fake-process tests, updates to `packages/pi-rpc/SPEC.md`, and updates to every affected product SPEC.
