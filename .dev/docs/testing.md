---
title: Testing Strategy
description: Choose verification by changed responsibility, run focused or real-Host checks, and read what each result does and does not establish.
scope:
  - /apps/**/test/**
  - /packages/**/test/**
  - /scripts/test/**
updated: 2026-10-29
---

# Testing Strategy

## Start with the changed responsibility

Test observable behavior and contracts, not implementation call order. During iteration, run the affected file or package first. Use `.agents/skills/dual-maintenance/SKILL.md` to judge whether a change is shared, plugin-local or Desktop-local; a VS Code editor integration does not require a Desktop launch merely because both products exist.

| Responsibility | Test owner and environment |
|---|---|
| RPC mechanics and dialects | `packages/pi-rpc`; decoder, fake-process and protocol fixtures |
| Shared Runtime/projection | `apps/pi-client/test/unit`; isolated Pi settings and controlled children where needed |
| Shared Registry/configuration/bridge | `apps/pi-client/test/host`; injected host services, without native product hosts |
| Shared UI and browser behavior | `apps/vscode/test/unit`; the extension package currently supplies the shared UI test infrastructure, including jsdom `*.dom.test.ts` component tests |
| VS Code adapter and sidebar/tab coordination | `apps/vscode/test`; native services are mocked in unit tests, while the E2E runner uses a real Extension Host |
| Desktop adaptation and state | `apps/desktop/test`; unit/integration tests inject native services; GUI smoke uses actual Tauri/WebView2 |
| Provider Usage engine | `packages/provider-usage`; credential/query policy and safe result contracts |

The shared UI tests' physical location does not make the implementation plugin-only. Vitest separates ordinary unit/SSR and DOM environments; browser tests use Svelte browser resolution. Reuse that infrastructure rather than treating a shared-client backend test run as component coverage.

For a focused run, replace the path below with the affected test:

```bash
pnpm --dir apps/vscode exec vitest run <affected.dom.test.ts>
pnpm --dir apps/pi-client exec vitest run <affected.test.ts>
pnpm --dir apps/desktop exec vitest run <affected.test.ts>
```

For watch mode, run `pnpm --dir <package> exec vitest`; append a test path to focus on one file.

Finish shared boundary/assembly changes with `pnpm check`. It runs version policy, lint (including the engineering scripts), types, tests, the internal JavaScript build for both products, and the plugin bundle budgets. That build is Rust-free, so the ordinary gate needs neither the Rust toolchain nor a window. `pnpm check:vscode` keeps shared and extension checks and excludes Desktop-only packages, so a Desktop-only failure does not gate an extension release. Rust checks, GUI smoke, Extension Host E2E, packaged verification and manual acceptance are separate commands, not hidden parts of either gate; run them when the changed path depends on native assembly, resources, launch or distribution.

Shared UI can also fail at a product-supplied theme, typography, resource-URL or shell boundary without changing a message contract. Exercise Desktop build/smoke when changing those dependencies. A component-private styling edit that does not change them does not by itself require a Desktop run; use focused tests and inspect the affected theme, focus and narrow-width states. DOM tests cannot establish browser-rendered typography or native resource loading.

## Real-client UI interaction

Use Desktop's Chrome DevTools Protocol (CDP) runner when shared ClientApp changes need real-browser layout, input or focus checks. Start ordinary component changes with the DOM tests above. Desktop results do not establish VS Code-specific bindings or native OS dialog behavior.

The executable embeds the renderer, so a renderer change needs a complete Desktop build (`pnpm build:desktop` or `pnpm --dir apps/desktop build`) before GUI smoke; a JS-only build leaves the existing executable serving the previous UI. Windows prerequisites are in [development.md](development.md#product-local-work).

Fixture setup, scenarios, wait helpers and cleanup belong to `apps/desktop/scripts/smoke.mjs`, which uses `apps/desktop/scripts/cdp-client.mjs` for CDP operations. Extend that runner with its existing helpers instead of adding a second automation path. Use its isolated Projects/profiles and controlled Pi, not the user's normal window or sessions. Tell the user before launching: the run opens and automatically operates visible windows, including close/reopen and crash checks.

## Real Host verification

| Verification | Entry | Prerequisite and effect |
|---|---|---|
| Extension Host E2E | `node apps/vscode/test/e2e/runTest.cjs` from the repository root | Extension built (`pnpm build:vscode`). Uses or downloads a VS Code executable, fresh profiles and a fixture outside Git, then runs the controlled suite in a real Extension Host |
| Desktop Rust check | `pnpm --dir apps/desktop exec cargo check --locked --manifest-path src-tauri/Cargo.toml` | Current JS/renderer via `node scripts/build.mjs --scope desktop` or a complete Desktop build. Compiles only; no window |
| Desktop Rust tests | `pnpm --dir apps/desktop exec cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol` | Same JS prerequisite; the custom-protocol feature embeds the renderer. No window |
| Desktop GUI smoke | From `apps/desktop`: `node scripts/smoke.mjs` | Executable from a complete Desktop build. The runner's default executable path is relative to the Desktop directory. Opens and drives real WebView2 windows |
| Packaged ZIP verification | `pnpm verify:desktop` | ZIP from `pnpm package:desktop`. Extracts outside the repository, runs the executable with isolated data and writes its report beside the archive |
| Manual acceptance | `pnpm test:desktop:manual` | Launches the packaged ZIP with an isolated profile and controlled Pi; `--reopen` reuses that profile for the same ZIP |

Desktop Rust tests and GUI smoke answer different questions. `cargo test` compiles with renderer assets embedded and runs Rust tests without opening the application. `smoke.mjs` starts the application to exercise renderer assembly, window lifecycle and native IPC. A passing Rust test does not show that the window renders, and a passing smoke run does not cover every Rust branch.

The E2E runner keeps the caller's proxy configuration for SDK downloads and sanitizes only the isolated test launch. Use `FROSTPI_VSCODE_EXECUTABLE` for an existing absolute VS Code launcher path when an offline run is needed, and `FROSTPI_E2E_TIMEOUT_MS` to override the 180-second watchdog. Timeout cleanup may stop only the owned runner tree, never a process-name wildcard, the user's IDE or its updater.

`pnpm verify:desktop` accepts `--real-pi` and `--native-dialogs`; an explicitly supplied archive is checked against its embedded version. `--real-pi` uses the installed runtime with isolated data and an offline-configured temporary extension command. It checks real command/confirmation/custom-message paths, not a model completion or durable real-Pi history. `PI_OFFLINE` suppresses automatic activity; it is not a sandbox against explicit model calls. Delivery gates are in [release.md](release.md#desktop-packaging-windows-x64).

`pnpm test:desktop:manual` runs `apps/desktop/scripts/manual-smoke.mjs` against the current ZIP in `artifacts/`; `--reopen` reuses that profile for the same ZIP. It is a setup step for human checks, not a pass attestation: write the task steps and the observed result in the change directory, not in this guide or a generated report. Closing the window, or the process exiting on its own, does not mark acceptance as passed.

## Evidence boundaries

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Type/import/schema checks | Environment boundaries and required declarations are consistent | Native operations work, labels/resources render, or every UI capability gate exists |
| Unit/DOM tests | The named state transitions, authorization, projection and interaction contracts hold under controlled inputs | Every product binding or a real model flow works |
| Extension Host E2E | The controlled suite ran in an actual VS Code host | Complete Webview, remote, theme or real-model acceptance; the current suite covers activation, registration and New/Stop commands |
| Native Desktop smoke | The shared client is assembled with Desktop and controlled Pi children through real WebView2/application IPC | Real model responses or real-Pi history behavior |
| Packaged Desktop verification | The identified ZIP extracts and its actual executable works outside the repository with isolated data | Arbitrary later source edits, signing, other platforms or final user experience |
| Shared Runtime with real Pi | The tested installed-runtime operations work through that implementation | The GUI and packaging paths were exercised |
| Real Pi GUI acceptance | The tested product/candidate completes the actual send, Stop, saved-history and blocking-input paths | Other runtime versions, providers or user extension combinations automatically work |

Synthetic capability states and real product declarations need separate checks. A function's presence does not prove file navigation or diagnostics behavior; an editor-tab action belongs to coordinator/dispatcher flow, not an assumed Host method. Preserve unsupported-path rejection as well as supported UI behavior.

A controlled process/GUI run passes only when its result explicitly reports success. A Desktop process exit alone is insufficient, and manually closing a window after an error is not acceptance. Extension Host E2E requires both a successful host exit and the suite-completion marker; a process that exited without running its suite did not pass. Report timeouts and environment-blocked runs as unverified, without inventing a product defect or a passing result.

Record actual results against the tested commit or archive SHA in CI artifacts or the relevant change record, not as evergreen pass claims in this guide. A shared UI propagation check must inspect actual product outputs; two similar screenshots or a disposable prototype do not prove shared implementation.

## Native checks and isolation

Desktop smoke runs the executable produced by a complete Desktop build; its runner creates temporary Projects, profiles, session roots and a controlled Pi fixture, and reports its temporary artifact directory. Those fixtures test identity, draft/input ownership, concurrency and persistence without model credentials. A startup exception before application import must still become a failed result, not a native dialog left waiting for a user.

Unit tests and controlled smoke use synthetic settings and temporary profiles, not real user settings or live sessions repurposed as fixtures. Keep real-runtime probes isolated, with any necessary authorization for account/model access. Preserve plugin light/dark/high-contrast, keyboard, reduced-motion and 280px usability checks where the changed UI is affected.

### Windows native evidence

Windows-specific phases extend the same runner; `apps/desktop/scripts/native-window.ps1` owns native automation. Dialog automation must target only windows owned by the test process.

Basic tray notices and confirmation buttons run in the regular suite. Add `--native-dialogs` to the smoke runner for file/folder and confirmation dialogs plus clipboard preservation on an unlocked foreground desktop; Windows focus restrictions make that phase unverified rather than passed, so it stays opt-in instead of seizing desktop focus. Composition events are browser checks, not a complete Windows IME acceptance result.

`verify:package` enforces the archive allowlist, extracts outside the repository and runs the same smoke suite against the extracted executable with the configured Windows desktop PATH. A test of a substituted native service establishes backend behavior, while a test of the actual dialog establishes its native binding. Real-model, accessibility, memory and startup-performance claims require their own evidence.
