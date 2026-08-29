---
title: Testing Strategy
description: Behavior-oriented verification categories and release-gate expectations.
scope:
  - /apps/vscode/test/**
  - /packages/pi-rpc/test/**
updated: 2026-07-28
---

# Testing Strategy

Test observable behavior and contracts, not implementation call order. During development, run the narrowest relevant package or test file before repository-wide checks.

Evidence covers transport framing/process behavior; lifecycle, persistence, history, and projection; pure Webview behavior and accessibility; Extension Host integration with controlled/fake Pi; visual review in light/dark/high-contrast at 280px; and packaging contents, identity, source maps, and bundle budgets.

Release gates and clean-host smoke testing are defined in [`release.md`](release.md). Environment-blocked E2E is reported with the blocker and never counted as passing.
