---
title: Testing Strategy
description: Select checks by changed responsibility, run isolated Host verification and interpret the results.
scope:
  - /apps/**/test/**
  - /packages/**/test/**
  - /scripts/test/**
updated: 2026-10-29
---

# Testing Strategy

## Start with the changed responsibility

Start with the affected file or package. [dual-maintenance](../../.agents/skills/dual-maintenance/SKILL.md) selects product ownership; a VS Code integration does not require a Desktop launch.

| Responsibility | Test owner/environment |
|---|---|
| RPC mechanics and dialects | `packages/pi-rpc`; decoder, fake processes and protocol fixtures |
| Shared Runtime/projection | `apps/pi-client/test/unit`; isolated Pi settings and controlled children |
| Shared Registry/configuration/bridge | `apps/pi-client/test/host`; injected services, no native hosts |
| Shared UI/browser behavior | `apps/vscode/test/unit`; jsdom `*.dom.test.ts` components |
| VS Code adapter and coordination | `apps/vscode/test`; mocked services or the actual Extension Host E2E runner |
| Desktop adaptation and state | `apps/desktop/test`; injected native services; real GUI smoke is separate |
| Provider Usage engine | `packages/provider-usage`; synthetic credentials and controlled network boundaries |

Shared UI tests live in the extension package but protect both products. Vitest separates ordinary unit/SSR and DOM projects; DOM tests use browser resolution. Shared-client backend tests are not component coverage.

```bash
pnpm --dir <package> exec vitest run <test-file>
pnpm --dir <package> exec vitest <test-file>       # watch
```

Finish shared boundary/assembly changes with `pnpm check`: version policy, lint, types, tests (including engineering scripts), both JS builds and extension bundle budgets. `pnpm check:vscode` excludes Desktop-only packages. Neither gate runs Rust, GUI smoke, E2E or packaged verification; select those explicitly below.

Shared UI changes affecting host-supplied themes, typography, resource URLs or shell integration need Desktop build/smoke. A component-private style edit alone does not; use focused tests and the [UI spec](design/ui-spec.md) for appearance, keyboard and narrow-width checks. DOM tests cannot establish rendered fonts or native resource loading.

## Real-client UI interaction

Use Desktop's CDP runner for real-browser layout, input and focus checks. Build with `pnpm build:desktop` first: JS-only output does not update the embedded renderer. See [development prerequisites](development.md#product-local-work).

Extend `apps/desktop/scripts/smoke.mjs` with its existing fixtures/waits and `cdp-client.mjs`; do not add another automation path. Tell the user before running it: it opens and operates visible windows, including close/reopen and crash checks. Desktop results do not establish VS Code bindings or native dialog behavior unless that operation is exercised.

## Real Host verification

Commands run from the repository root unless another directory is shown.

| Task | Entry | Prerequisite/effect |
|---|---|---|
| Extension Host E2E | `node apps/vscode/test/e2e/runTest.cjs` | Build the extension first; uses/downloads VS Code and opens an isolated Host |
| Rust compile check | `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Windows toolchain and current JS/renderer; no window |
| Rust tests | `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol` | Same prerequisite; embeds renderer assets and runs Rust tests, not GUI |
| Desktop GUI smoke | From `apps/desktop`: `node scripts/smoke.mjs` | Complete Desktop build; default exe path is relative to that directory |
| Packaged verification | `pnpm verify:desktop [archive.zip]` | Existing ZIP; extracts/runs it outside the checkout and writes an adjacent report; no rebuild |
| Human acceptance | `pnpm test:desktop:manual [--reopen]` | Opens the current ZIP with controlled Pi and temporary data; reopen requires the same ZIP |

For Rust-only work, `node scripts/build.mjs --scope desktop` supplies the JS/renderer prerequisite without compiling the exe. For GUI checks, use a complete build instead. Packaging and publication gates belong to [release.md](release.md#desktop-packaging-windows-x64).

## Evidence boundaries

| Evidence | Establishes | Does not establish |
|---|---|---|
| Type/import/schema checks | Consistent declarations and environment boundaries | Working native operations or rendered resources |
| Unit/DOM tests | Named behavior under controlled inputs | Every real Host binding or model flow |
| Extension Host E2E | Suite execution in VS Code; currently activation, registration and New/Stop | Complete Webview, remote, theme or real-model acceptance |
| Desktop GUI smoke | Real WebView2/application IPC, hide/restore and renderer-failure cleanup with controlled Pi | Tray menu Exit/confirmation, real-Pi history or model responses |
| Packaged verification | The identified ZIP's extracted exe works with isolated data | Later source edits, signing, other OSes or complete user experience |
| Shared Runtime with real Pi | Selected operations with the installed runtime | GUI/packaging behavior |
| Real Pi GUI acceptance | Actual tested send, Stop, history and blocking-input paths | Every runtime/provider/extension combination |

Require explicit successful results, not just process exit. Extension Host E2E needs both a successful exit and its suite-completion marker. Closing the manual-test window does not mark acceptance as passed; record human steps/results in the change directory. Treat timeout/environment-blocked runs as unverified, not passed or automatically a product defect.

Record results against the commit or archive SHA, not as evergreen claims here. Shared-source propagation needs actual product outputs; matching screenshots or a prototype do not prove shared implementation.

## Native checks and isolation

Automated tests use synthetic settings, temporary Projects/profiles/session roots and controlled Pi, never real user sessions repurposed as fixtures. Smoke reports its artifact directory. Startup exceptions must fail the run rather than leave a native dialog waiting. Real account/model probes need appropriate authorization.

The E2E runner preserves caller proxies for SDK downloads, then sanitizes the isolated launch. `FROSTPI_VSCODE_EXECUTABLE` selects an existing absolute launcher for offline runs; `FROSTPI_E2E_TIMEOUT_MS` overrides the 180-second watchdog. Cleanup may stop only the owned runner tree, never a process-name wildcard, the user's IDE or updater.

`verify:desktop` checks an explicitly supplied archive against its embedded version, not the checkout. Its optional `--real-pi` uses isolated data and an offline extension command/confirmation/custom-message path; it does not test model completion or durable real-Pi history. `PI_OFFLINE` suppresses automatic activity, not explicit model calls. `verify:desktop` and the smoke runner also accept `--native-dialogs` as described below.

### Windows native evidence

Native automation (`apps/desktop/scripts/native-window.ps1`) must target only test-process windows. Regular smoke checks hide/restore and renderer-failure cleanup; its `manualChecks` lists tray right-click Exit/confirmation, which Windows menu automation cannot reliably exercise. For those checks, use `test:desktop:manual`, exit through the tray, reopen with `--reopen` and exit again; record the ZIP SHA and observed results separately. Do not relabel renderer-failure cleanup as normal Exit coverage.

`--native-dialogs` additionally exercises file/folder dialogs and clipboard preservation on an unlocked foreground desktop. Focus restrictions make that phase unverified, not passed; keep it opt-in. Composition events are not complete Windows IME acceptance.

Mocked native services establish backend behavior, not OS bindings. Real dialogs, accessibility, memory and startup-performance claims each require evidence at that boundary.
