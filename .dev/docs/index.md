---
title: FrostPi Engineering Guide
description: Task router for current architecture, module contracts, and repository workflows.
scope:
  - /**
updated: 2026-10-03
---

# FrostPi Engineering Guide

Always follow [`AGENTS.md`](../../AGENTS.md).

- Feature location unknown → [`feature-map.md`](feature-map.md).
- Module behavior change → read the nearest `*.SPEC.md` before editing.
- Cross-module boundaries, trust, or process topology → [`architecture/overview.md`](architecture/overview.md).
- Cross-feature Webview layout, accessibility, or theme constraints → [`design/ui-spec.md`](design/ui-spec.md).
- Pi compatibility spanning transport and product modules → [`protocol/pi-rpc-compatibility.md`](protocol/pi-rpc-compatibility.md) plus affected SPECs.
- Extending or maintaining OMP compatibility → [`architecture/omp-compatibility.md`](architecture/omp-compatibility.md) for the two-layer design, translation criteria, capability rollout, and change archival rules.
- Repository workflow → read only the relevant guide: [`development.md`](development.md), [`testing.md`](testing.md), [`release.md`](release.md), or [`troubleshooting.md`](troubleshooting.md).
- `.dev/backlog/` and `.dev/changes/` contain lifecycle/history artifacts; read them only when a task explicitly targets them, never as current contracts.
