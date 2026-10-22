---
title: Testing Strategy
description: Behavior checks, environment isolation, dual-client evidence, and release gates.
scope:
  - /apps/**/test/**
  - /packages/**/test/**
updated: 2026-10-22
---

# Testing Strategy

Test observable behavior and contracts, not implementation call order. Run the narrowest affected package/file before repository-wide checks.

`apps/pi-client/test/unit` owns Runtime/projection tests; `test/host` owns shared collection/configuration/bridge behavior with injected fake host services. The shared fake Pi fixture is `apps/pi-client/test/fixtures/fake-pi.cjs`. These tests isolate Pi settings and need no real VS Code, Electron GUI or model account.

`apps/vscode/test` owns native adapter, sidebar/tab coordination, browser behavior and controlled Extension Host E2E. Vitest separates ordinary unit/SSR from `**/*.dom.test.ts` component tests; DOM tests use jsdom and browser Svelte resolution. Synthetic sources stay test-only.

`apps/desktop/test` owns Project/host adaptation and finite desktop interactions. Unit tests mock the Electron system boundary rather than load a native app or download a binary. The separate `test:smoke` launches real Electron and controlled Pi children through the real shared ClientApp/Registry/bridge. A smoke exit is successful only if its result artifact explicitly reports success; Electron process exit alone is insufficient.

## Evidence boundaries

- Source/type/import checks protect the Node/shared/UI boundaries and expose missing adapter capabilities.
- Unit/DOM tests protect lifecycle, persistence, history, projection, message authorization, draft ownership, UI interactions and explicit unsupported operations. Desktop settings tests cover whitelist import, atomic storage, invalid-file protection, proxy conversion, original key names, and executing the bundled JSONC reader (source-only tests cannot detect unresolved UMD requires).
- Controlled Desktop smoke protects two unrelated Project roots, shared New/conversation rendering, concurrent child execution, foreground/cwd separation, Stop isolation and renderer Node/IPC isolation. It also checks first-run import preview/Save/Reset/reopen, actual shared message/composer/code typography, 280px settings layout, and no implicit child restart on executable/proxy changes. A bootstrap reports even pre-import startup exceptions as failed artifacts instead of leaving a native error dialog. It is not evidence of real model responses or real saved-history resume.
- Real-Pi acceptance must separately exercise send, Stop, saved-history recovery and a blocking input. A shared UI change must be observed in both product outputs; a copied/mock page does not satisfy this requirement.
- Preserve plugin light/dark/high-contrast and 280px behavior; inspect Desktop navigation at narrow widths without shrinking the shared client below its usable layout.

The package-local development/preview commands are in [development](development.md). Root `pnpm check` covers lint, types, tests, both builds and the existing plugin bundle budgets; native GUI smoke and Extension Host E2E are separate explicit checks.

Extension Host E2E copies its fixture outside the repository so sibling Git worktrees cannot open a native directory picker. Unset `ELECTRON_RUN_AS_NODE` for that test launcher, not for plugin child-process policy. Packaging/clean-host release gates remain in [release](release.md). Environment-blocked checks must be reported as unverified, never counted as passes.
