---
title: Development Workflow
description: Workspace setup, independent product builds, shared-source resolution and setting generation.
scope:
  - /**
updated: 2026-10-24
---

# Development Workflow

## Workspace setup

Use Node 20.19+ and the repository's pnpm 10 version. Windows Desktop packaging requires Node 22.12+; this does not raise the extension build minimum. The installed Pi runtime can have a newer Node requirement of its own.

Install once from the repository root:

```bash
pnpm install --frozen-lockfile
```

The root lockfile covers all workspaces. Do not create app-local installations or lockfiles. Packages own their local scripts; root `build`, `typecheck`, `lint`, `test` and `check` orchestrate the workspaces. Root quality checks run packages serially; a package-local command is the normal starting point for an affected feature.

## Product-local work

| Work | Entry | What it includes |
|---|---|---|
| Build the VS Code extension | `pnpm --dir apps/vscode build` | Shared dependencies and extension outputs, not Desktop |
| Debug the extension | `.vscode/launch.json` | The `build:debug` pre-launch task uses the extension-local build and sets `FROSTPI_SOURCEMAP=1` for Host source maps/unminified output; production output stays minified for the bundle budget |
| Check shared types | `pnpm --dir apps/pi-client typecheck` | Separate core/shared/UI environment checks. Package-local `test` covers backend/host behavior; shared UI component tests use the vscode package's DOM infrastructure, as described in testing.md |
| Build Desktop | `pnpm --dir apps/desktop build` | Electron main/preload and a renderer consuming the same ClientApp |
| Run Desktop | `pnpm --dir apps/desktop start` | Development launch; pass directory arguments or add Projects through its native directory picker |

VS Code remains in its workspace Extension Host, including remote workspaces. Do not move its process placement or require a Desktop launch to develop an editor integration. Use `.agents/skills/dual-maintenance/SKILL.md` to decide whether a shared change needs Desktop adaptation, and `.dev/docs/testing.md` to select verification.

For Desktop experiments, set `FROSTPI_DESKTOP_USER_DATA` in the launched process's environment to an isolated directory. Ordinary launches keep the system application-data FrostPi profile. Automated tests use temporary profiles and synthetic settings, not real user configuration. Settings import and state/reopen behavior are contracts in `apps/desktop/SPEC.md`, not extra development steps.

Desktop launchers remove `ELECTRON_RUN_AS_NODE` from their own launch environment. Do not change Pi runtime policy or global environment variables to compensate for it. Electron's native executable must be available: a successful dependency install or renderer build alone does not prove it can launch.

`pnpm --dir apps/desktop test:smoke` requires a current build and runs actual Electron with controlled Pi children. It reports an explicit result and temporary artifact directory; it does not use model credentials. Creating and validating an independent ZIP is a separate delivery flow in `.dev/docs/release.md`, not part of normal plugin development.

## Setting definitions

FrostPi schemas/defaults are authored in `apps/vscode/package.json` under `contributes.configuration`. Shared runtime defaults and browser-safe setting definitions are generated from that source:

```bash
pnpm --dir apps/pi-client settings:generate
pnpm --dir apps/pi-client settings:check
```

Include generated changes with the schema edit. Both product builds reach the stale-output check through the shared-client build. Runtime code consumes the generated modules, not the product manifest; do not hand-edit generated values or add host-local fallback tables.

Generation does not implement a new setting. Wire its parsing, behavior and applicable host support, then verify the affected path. Native VS Code settings such as `chat.*`, `editor.*` and exclusion maps are not FrostPi manifest definitions. Desktop's import whitelist and original-key storage are owned by its settings contract.

## Shared source resolution

Product TypeScript, Vite, Vitest and esbuild mappings must select the same `apps/pi-client` implementation. Backend exports use built JS/declarations; browser builds consume exported Svelte/CSS source. Preserve the separate environment entries rather than introducing a root barrel that mixes browser and Node modules. Shared code declares its own runtime/type dependencies.

Both products bundle the common `apps/pi-client/pi-extensions` sources into their outputs. Shared styles use one common entry, and vendor/font URLs must retain their entry-relative layout. A copied implementation or separately maintained asset list would require manual propagation and defeat the shared-source maintenance model. Source ownership is mapped in `.dev/docs/feature-map.md`; environment constraints are in `apps/pi-client/SPEC.md`.

The independent `packages/provider-usage` engine has its own package-local checks. Versioning and publication are handled by `.dev/docs/release.md`, not by editing package versions during ordinary development.

### Windows Tauri candidate

The Tauri migration currently runs alongside the verified Electron entry. Native builds require Windows x64, the stable Rust MSVC toolchain, Visual Studio C++ build tools/Windows SDK, and WebView2 Runtime. Node 22.19+ and Pi remain external runtime prerequisites. Install JS dependencies from the repository root as usual; do not create a separate Desktop lockfile.

```bash
pnpm --dir apps/desktop build:tauri
pnpm --dir apps/desktop start:tauri
pnpm --dir apps/desktop check:native
pnpm --dir apps/desktop test:native
pnpm --dir apps/desktop test:tauri src-tauri/target/release/frostpi-desktop.exe
pnpm --dir apps/desktop package:tauri
pnpm --dir apps/desktop verify:tauri
```

`pnpm check` continues to validate the shared/extension/Desktop JavaScript and TypeScript boundary without requiring Rust. Run the explicit native check/build/smoke on Windows for changes to the Tauri shell. `test:tauri` uses a real WebView2 window with isolated settings/Pi data and a controlled Pi fixture, not a model request. Its DevTools endpoint is enabled only by the test launcher. The candidate is not the default Desktop release; large-message parity and native acceptance gates are recorded in the Desktop SPEC.
