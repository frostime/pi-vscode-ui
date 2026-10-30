---
title: FrostPi Engineering Guide
description: Choose the source map, contract or workflow needed for a maintenance task.
scope:
  - /**
updated: 2026-10-29
---

# FrostPi Engineering Guide

`AGENTS.md` states the Pi GUI's purpose, the two products' relationship and global boundaries. Use this router for the task at hand; the docs are not a required reading sequence.

## Locate the owner and contract

| Question | Read |
|---|---|
| Where is a feature implemented? | [feature-map.md](feature-map.md), then the nearest module SPEC with its code |
| Does a change belong to shared code, VS Code or Desktop? | [dual-maintenance](../../.agents/skills/dual-maintenance/SKILL.md), for adaptation and first-check decisions |
| How do processes, state and data boundaries fit together? | [architecture/overview.md](architecture/overview.md), including its data ownership table |
| What must shared application/host changes preserve? | [apps/pi-client/SPEC.md](../../apps/pi-client/SPEC.md) |
| What are the Session state, Fork and recovery rules? | [session-lifecycle.SPEC.md](../../apps/pi-client/src/host/session-lifecycle.SPEC.md); it also identifies the VS Code reference policy |
| How do browser messages, pinned views and draft handoff work? | [webview-bridge.SPEC.md](../../apps/pi-client/src/shared/bridge/webview-bridge.SPEC.md) |
| Which Desktop invariants must host, navigation or renderer changes preserve? | [apps/desktop/SPEC.md](../../apps/desktop/SPEC.md) |
| What spans shared UI layout, styles, themes and accessibility? | [design/ui-spec.md](design/ui-spec.md); feature-specific details stay with their feature |
| Which Pi protocol assumptions cross module boundaries? | [protocol/pi-rpc-compatibility.md](protocol/pi-rpc-compatibility.md) and the RPC package SPEC |
| How should OMP support be extended without spreading runtime branches? | [architecture/omp-compatibility.md](architecture/omp-compatibility.md), for the two-layer design and ownership test |

## Choose a workflow

- [development.md](development.md): install dependencies, build/start a product, generate settings and preserve shared-source resolution.
- [testing.md](testing.md): choose checks by changed responsibility, run focused or real-Host tests, and interpret their evidence.
- [release.md](release.md): version, package, verify and publish each product with its release gates and credentials.
- [troubleshooting.md](troubleshooting.md): investigate runtime, discovery, search or editor symptoms before changing behavior.

`.dev/changes/` and `.dev/backlog/` contain task context and historical evidence. Read them when working on that task; current architecture and module contracts do not depend on replaying old sessions or plans.
