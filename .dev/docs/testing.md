---
title: Testing Strategy
description: Behavior checks, environment isolation, dual-client evidence, and release gates.
scope:
  - /apps/**/test/**
  - /packages/**/test/**
updated: 2026-10-23
---

# Testing Strategy

Test observable behavior and contracts, not implementation call order. Run the narrowest affected package/file before repository-wide checks.

`apps/pi-client/test/unit` owns Runtime/projection tests; `test/host` owns shared collection/configuration/bridge behavior with injected fake host services. The shared fake Pi fixture is `apps/pi-client/test/fixtures/fake-pi.cjs`. These tests isolate Pi settings and need no real VS Code, Electron GUI or model account.

`apps/vscode/test` owns native adapter, sidebar/tab coordination, browser behavior and controlled Extension Host E2E. Vitest separates ordinary unit/SSR from `**/*.dom.test.ts` component tests; DOM tests use jsdom and browser Svelte resolution. Synthetic sources stay test-only.

`apps/desktop/test` owns Project/host adaptation and finite desktop interactions. Unit tests mock the Electron system boundary rather than load a native app or download a binary. The separate `test:smoke` launches real Electron and controlled Pi children through the real shared ClientApp/Registry/bridge. A smoke exit is successful only if its result artifact explicitly reports success; Electron process exit alone is insufficient.

## Evidence boundaries

- Source/type/import checks protect the Node/shared/UI boundaries and expose missing required adapter declarations. Capability DOM tests cover named controls with synthetic support states; product adapter tests separately check the actual constants and native operations. Editor-tab execution is checked through coordinator/dispatcher behavior, not assumed to be a Host method. None of these tests automatically discovers every future omitted UI gate.
- Unit/DOM tests protect lifecycle, persistence, history, projection, message authorization, draft ownership, UI interactions and explicit unsupported operations. Desktop settings tests cover whitelist import, atomic storage, invalid-file protection, proxy conversion, original key names, and executing the bundled JSONC reader (source-only tests cannot detect unresolved UMD requires).
- Controlled Desktop smoke protects two unrelated Project roots, shared New/conversation rendering, concurrent child execution, foreground/cwd separation, Stop isolation and renderer Node/IPC isolation. It also checks first-run import preview/Save/Reset/reopen, actual shared message/composer/code typography, 280px settings layout, shared settings menu/startup-failure entry routes, and no implicit child restart on executable/proxy changes. A bootstrap reports even pre-import startup exceptions as failed artifacts instead of leaving a native error dialog. It is not evidence of real model responses or real saved-history resume.
- State-store tests cover Project/Memento field interleaving, desired metadata after write failure, invalid-file protection and queue flushing. Controlled reopen smoke additionally closes a real Electron window, reopens stable Project/session identities, reads synthetic Pi-owned JSONL, counts only selected-session auto-start, excludes Provisional/Ephemeral entries and verifies no automatic prompt replay or fallback auto-start from a saved null selection. Registry unit tests separately release delayed New/Resume discovery after disposal and verify no new runtime or save. These are not process snapshots or real-Pi acceptance.
- `pnpm verify:desktop` tests the distributed Windows ZIP, not the development Electron binary. It checks archive contents, extracts outside the workspace and drives the actual executable with isolated data through the shared UI. Native process startup, local fonts/vendor assets and profile reopen must work without repository source or a developer launch wrapper. The optional `pnpm verify:desktop --real-pi` stage also launches the installed Pi in an isolated, offline-configured profile and exercises a temporary extension command, a real confirmation card and custom-message display. It supplies no credentials and exercises no model completion or durable Pi history; `PI_OFFLINE` disables automatic activity, not explicit model calls. Controlled fake messages still cover streaming Stop and disk-history reopen. Code signing and public distribution remain separate gates.
- Real-Pi acceptance must separately exercise send, Stop, saved-history recovery and a blocking input. A shared UI change must be observed in both product outputs; a copied/mock page does not satisfy this requirement.
- Preserve plugin light/dark/high-contrast and 280px behavior; inspect Desktop navigation at narrow widths without shrinking the shared client below its usable layout.

The package-local development/preview commands are in [development](development.md). Root `pnpm check` covers lint, types, tests, both builds and the existing plugin bundle budgets; native GUI smoke and Extension Host E2E are separate explicit checks.

Extension Host E2E (`pnpm --dir apps/vscode test:e2e`) uses a fixture outside Git, fresh VS Code/Pi profiles and software rendering for automation. SDK downloads retain the caller's proxy configuration; only the subsequent test launch sanitizes inherited terminal/Electron/proxy variables in its isolated subprocess. Set `FROSTPI_VSCODE_EXECUTABLE` to the absolute path of an existing normal VS Code launcher for an offline run; otherwise the SDK selects/downloads its default. `FROSTPI_E2E_TIMEOUT_MS` overrides the 180s watchdog when needed. Timeout/cancellation stops only the owned test-runner process tree, never a process-name wildcard. Keep the updater's normal locks; do not interfere with the user's IDE.

The runner prints its temporary artifact directory and requires both host exit 0 and the suite-completion marker. Exit 0 alone cannot establish that the suite ran. This suite checks activation, command registration and New/Stop command completion with a controlled Pi, not complete Webview behavior or real model use. Packaging/clean-host release gates remain in [release](release.md). Environment-blocked checks must be reported as unverified, never counted as passes.
