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

App Vitest projects separate ordinary unit/SSR tests from `test/unit/**/*.dom.test.ts` component interaction tests. DOM tests use jsdom and Svelte browser resolution; ordinary tests retain server resolution. Run either through the normal package test command, for example `pnpm --dir apps/vscode exec vitest run test/unit/providerUsagePanel.dom.test.ts`. Component tests use synthetic sources, not live accounts.

Evidence covers transport framing/process behavior; lifecycle, persistence, history, and projection; pure Webview behavior and accessibility; Extension Host integration with controlled/fake Pi; visual review in light/dark/high-contrast at 280px; and packaging contents, identity, source maps, and bundle budgets.

Release gates and clean-host smoke testing are defined in [`release.md`](release.md). Environment-blocked E2E is reported with the blocker and never counted as passing.
