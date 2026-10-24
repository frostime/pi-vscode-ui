---
title: Pi RPC Compatibility
description: Which module owns each Pi RPC compatibility decision, and which failures must stay visible across the boundary.
scope:
  - /packages/pi-rpc/**
  - /apps/pi-client/src/core/**
  - /apps/pi-client/src/host/**
updated: 2026-10-24
---

# Pi RPC Compatibility

FrostPi provides a GUI for Pi. It launches the selected runtime with `--mode rpc` and consumes the documented Pi-compatible RPC surface. It does not bundle, pin, or patch Pi, and it does not target a generic backend, ACP, or another agent SDK. It also does not claim complete support for an alternate runtime's feature set. Both products run the same session lifecycle and conversation projection; where a runtime difference cannot be normalized at the transport, it stays explicit in the product compatibility layer.

The `oh-my-pi` profile for Oh My Pi (OMP) is the one alternate runtime profile. It supports a bounded subset of that runtime; see [OMP compatibility](../architecture/omp-compatibility.md) for the exact supported surface and for how to assign a new runtime difference.

Transport mechanics such as framing, correlation, reassembly, negotiation and process lifecycle belong to [`packages/pi-rpc/SPEC.md`](../../../packages/pi-rpc/SPEC.md). This guide does not restate them. It records who owns each compatibility decision and which failures must not be hidden.

## Ownership

| Concern | Owner | Contract |
|---|---|---|
| Child process, framing, correlation, reassembly, negotiation | `packages/pi-rpc` | `packages/pi-rpc/SPEC.md` |
| Runtime dialect: handshake, vocabulary, isomorphic event normalization, bounded command discovery | `packages/pi-rpc/src/dialects/` | package SPEC and dialect comments |
| Runtime profile: executable fallback, session root, Pi-settings use, product capabilities | `apps/pi-client/src/core/configuration/runtimeCompatibility.ts` | [OMP compatibility](../architecture/omp-compatibility.md) and the profile source |
| Session state, feature policy, lifecycle, gates | `apps/pi-client/src/core/sessions/` and `apps/pi-client/src/host/` | [`session-lifecycle.SPEC.md`](../../../apps/pi-client/src/host/session-lifecycle.SPEC.md) |
| Conversation order and persisted/live identity | `apps/pi-client/src/core/conversation/` | [`conversation-projection.SPEC.md`](../../../apps/pi-client/src/core/conversation/conversation-projection.SPEC.md) |

A dialect may translate only what it can normalize without product knowledge. Anything that depends on session state, earlier events, UI interaction, or product commit rules stays above the RPC boundary. The decision procedure and its four isomorphism conditions are in [OMP compatibility](../architecture/omp-compatibility.md); the rest of this guide records the consequences for the other modules.

## Tolerance and failure

Tolerance is for additive change, not for broken invariants. Unknown events and unknown fields are accepted, so a runtime can add protocol surface without breaking FrostPi. A required invariant that becomes impossible is a failure, never something to repair by guessing.

Local tolerance stays local: ignoring a malformed assistant update is acceptable, but the same tolerance must not turn malformed JSONL, a startup failure, or an unexpected process exit into a quiet success.

The same rule governs substitution. A failed negotiation fails startup instead of silently reverting to an older protocol, and a missing, corrupt, or incompatible restored session fails visibly; FrostPi never opens an empty session under the same UI identity. Recovery policy is in [session lifecycle](../../../apps/pi-client/src/host/session-lifecycle.SPEC.md), not in the transport.

## Capability gates

A capability declares what the product offers, and the gate is checked before the runtime is asked. An unavailable operation is rejected at the product entry point or not offered at all; it is never submitted and answered as `Unknown command`. Missing capability is visible, and an unavailable private adapter reports diagnostics instead of silently falling back to a degraded path. Adapters that cover a capability gap, such as session-tree navigation, fork and the Question tool, are product modules above the normalized transport, not dialect features.

Capabilities are not inferred from whichever RPC events happen to arrive, and discovering a command does not prove FrostPi can complete its lifecycle. FrostPi's local extension commands and the runtime's slash commands are separate submission paths; support for one says nothing about the other. The OMP profile's supported surface and the reasons for its limits are in [OMP compatibility](../architecture/omp-compatibility.md).

## Runtime authority

The child runtime owns session JSONL, model and session state, runtime settings, migration, and extension lifecycle. FrostPi does not write or migrate those runtime-owned files, keeps no second provider credential store, and adds no global execution lock. One `SessionRuntime` owns one child.

`get_entries` plus the reported leaf is the persisted transcript authority, including entries before compaction; `get_messages` is the current LLM context and must not hydrate the projected conversation. The projection contract owns how that chain is read.

The child reports the effective model and thinking level, and FrostPi treats that confirmed state as authoritative: a runtime that clamps a requested value is reflected rather than overridden by the request. A profile also declares whether FrostPi may reuse Pi's settings for its own projections; where it does not, Pi-derived diagnostics such as cache-miss notices are absent.

## Derived presentation

RPC carries assistant usage and cost data, not Pi TUI's rendered warning text. Cache-miss notices are therefore derived presentation, owned by [conversation projection](../../../apps/pi-client/src/core/conversation/conversation-projection.SPEC.md) and never written as session entries.

## Invocation

The transport inserts `--mode rpc` after the resolved command and before the configured arguments, so configured arguments are interpreted by a runtime already in RPC mode. [`configuredPiInvocation.ts`](../../../apps/pi-client/src/core/configuration/configuredPiInvocation.ts) turns the configured executable into that command shape: `.js`, `.mjs`, and `.cjs` entry points run through `node`; native executables run directly. When no executable is configured, [`resolvePiExecutable.ts`](../../../packages/pi-rpc/src/process/resolvePiExecutable.ts) owns PATH and current-process resolution. Restored sessions add `--session <path>`, and ephemeral sessions add `--no-session`.

The transport merges caller environment overrides but does not interpret proxy policy or credentials.

## Change evidence

A compatibility change needs captured fixtures or fake-process tests and an update to each SPEC whose contract it changes; implementation-only fixes do not require mechanical SPEC edits. A change that alters the supported surface must also update the runtime profile and the gates that depend on it. Follow [evidence boundaries](../testing.md#evidence-boundaries) for what unit, fake-process, smoke and real-runtime checks establish. For OMP-specific ownership decisions and validation against the installed runtime, also follow the [OMP maintenance workflow](../architecture/omp-compatibility.md).
