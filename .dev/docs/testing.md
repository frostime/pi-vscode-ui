---
title: Testing Strategy
description: Choose verification by changed responsibility, understand evidence limits, and run isolated native checks.
scope:
  - /apps/**/test/**
  - /packages/**/test/**
updated: 2026-10-28
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
| VS Code adapter and sidebar/tab coordination | `apps/vscode/test`; native services are mocked in unit tests, while `test:e2e` runs a real Extension Host |
| Desktop adaptation and state | `apps/desktop/test`; unit/integration tests inject native services; `test:smoke` runs actual Tauri/WebView2 |
| Provider Usage engine | `packages/provider-usage`; credential/query policy and safe result contracts |

The shared UI tests' physical location does not make the implementation plugin-only. Vitest separates ordinary unit/SSR and DOM environments; browser tests use Svelte browser resolution. Reuse that infrastructure rather than treating a shared-client backend test run as component coverage.

For a focused run, replace the path below with the affected test:

```bash
pnpm --dir apps/vscode exec vitest run <affected.dom.test.ts>
pnpm --dir apps/pi-client exec vitest run <affected.test.ts>
pnpm --dir apps/desktop exec vitest run <affected.test.ts>
```

Finish shared boundary/assembly changes with `pnpm check`. It checks version policy, lint, types, tests, both product builds and the plugin bundle budgets. Extension releases use `pnpm check:vscode`, which retains shared/extension checks but excludes Desktop-only packages. GUI smoke, Extension Host E2E and packaged-executable verification are separate commands, not hidden parts of that gate. Run them when the changed path depends on native assembly, resources, launch or distribution. Release gates are in `.dev/docs/release.md`.

Shared UI can also fail at a product-supplied theme, typography, resource-URL or shell boundary without changing a message contract. Exercise Desktop build/smoke when changing those dependencies. A component-private styling edit that does not change them does not by itself require a Desktop run; use focused tests and inspect the affected theme, focus and narrow-width states. DOM tests cannot establish browser-rendered typography or native resource loading.

## Real-client UI interaction

Use Desktop's Chrome DevTools Protocol (CDP) runner when shared ClientApp changes need real-browser layout, input or focus checks. Start ordinary component changes with the DOM tests above. Desktop results do not establish VS Code-specific bindings or native OS dialog behavior.

```bash
pnpm --dir apps/desktop build:native
pnpm --dir apps/desktop test:smoke
```

The executable embeds the renderer: UI changes require `build:native`; a JS-only build leaves the existing executable stale. Windows prerequisites are in [development.md](development.md#product-local-work).

When adding an interaction, read `apps/desktop/scripts/smoke.mjs` for fixture setup, scenarios and cleanup, and `apps/desktop/scripts/cdp-client.mjs` for CDP operations. Extend that runner using its existing client and wait helpers. It currently runs the complete smoke suite.

Use the runner's isolated Projects/profiles and controlled Pi, not the user's normal window or sessions. Tell the user before launching: tests open and automatically operate visible windows, including close/reopen and crash checks. Native acceptance and result interpretation follow the sections below.

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

A controlled process/GUI run passes only when its result explicitly reports success. A Desktop process exit alone is insufficient. Extension Host E2E requires both a successful host exit and the suite-completion marker; a process that exited without running its suite did not pass. Report timeouts and environment-blocked runs as unverified, without inventing a product defect or a passing result.

Record actual results against the tested commit or archive SHA in CI artifacts or the relevant change record, not as evergreen pass claims in this guide. A shared UI propagation check must inspect actual product outputs; two similar screenshots or a disposable prototype do not prove shared implementation.

`pnpm test:desktop:manual` launches the packaged ZIP with controlled Pi and temporary profiles for human checks; `--reopen` reuses that test profile for the same ZIP. Record task-specific steps and human results in the relevant change directory, not this guide or an automated pass report.

## Native checks and isolation

Desktop smoke requires a current `pnpm --dir apps/desktop build:native`, then `pnpm --dir apps/desktop test:smoke`. It uses temporary Projects, profiles and controlled Pi fixtures, including synthetic JSONL and launch counters for reopen cases. Those fixtures test identity, draft/input ownership, concurrency and persistence without model credentials. The runner reports its temporary artifact directory. A startup exception before application import must still become a failed result, not a native dialog left waiting for a user.

`pnpm verify:desktop` verifies the distributed ZIP through its extracted executable. The optional `--real-pi` phase uses the installed runtime with isolated data and an offline-configured temporary extension command. It checks real command/confirmation/custom-message paths, not a model completion or durable real-Pi history. `PI_OFFLINE` suppresses automatic activity; it is not a sandbox against explicit model calls. See `.dev/docs/release.md` for the delivery flow.

For `pnpm --dir apps/vscode test:e2e`, the runner uses a fixture outside Git, fresh VS Code/Pi profiles and software rendering. SDK downloads keep the caller's proxy configuration; environment sanitization applies only to the later isolated test launch. Use `FROSTPI_VSCODE_EXECUTABLE` for an existing absolute VS Code launcher path when an offline run is needed. `FROSTPI_E2E_TIMEOUT_MS` overrides the 180-second watchdog. Timeout cleanup may stop only the owned runner tree, never a process-name wildcard, the user's IDE or its updater.

Unit tests and controlled smoke use synthetic settings and temporary profiles, not real user settings or live sessions repurposed as fixtures. Keep real-runtime probes isolated, with any necessary authorization for account/model access. Preserve plugin light/dark/high-contrast, keyboard, reduced-motion and 280px usability checks where the changed UI is affected.

### Windows native evidence

The Desktop `test:smoke` runner launches the native release executable and exercises WebView2 through a test-launcher-enabled loopback DevTools endpoint. Native dialog automation targets only HWNDs owned by that test process. Controlled fixtures cover Project concurrency/Stop, Resume, settings/drafts, message limits, appearance, tray hide/restore and Exit confirmation, shutdown/reopen and Job Object cleanup. Tray smoke sends native notifications to the owned tray window and selects its real menu command; `apps/desktop/scripts/native-window.ps1` records the pinned `tray-icon` behavior it depends on. Basic tray notices/confirmation buttons run in the regular suite; foreground-dependent file-dialog typing remains opt-in. Add `--native-dialogs` to exercise file/folder and confirmation dialogs plus clipboard preservation on an unlocked foreground desktop. Windows focus restrictions make that phase unverified rather than passed; keep it explicit so the regular suite does not seize desktop focus. Composition events are browser checks, not a complete Windows IME acceptance result.

`test:native` covers the Node launcher using a canonical verbatim directory with spaces/Unicode. `verify:package` enforces the archive allowlist, extracts outside the repository and runs this same native suite with configured machine/user PATH; it records archive SHA-256 and explicit results. A test of a substituted native service establishes backend behavior, while a test of the actual dialog establishes its native binding. Real-model, accessibility, memory and startup-performance claims require their own evidence.
