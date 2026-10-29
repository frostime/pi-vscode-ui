---
title: Development Workflow
description: Install the workspace, understand the common command entries, build and start each product, generate settings and preserve shared-source resolution.
scope:
  - /**
updated: 2026-10-29
---

# Development Workflow

## Workspace setup

Use Node 20.19+ and the repository's pnpm 10 version. Windows Desktop runtime requires Node 22.19+; this does not raise the extension build minimum. The installed Pi runtime can have a newer Node requirement of its own.

Install once from the repository root:

```bash
pnpm install --frozen-lockfile
```

The root lockfile covers all workspaces. Do not create app-local installations or lockfiles.

## Command entries

Root scripts name common tasks: each entry states which product or check you get, not every internal step. Each package keeps `build`, `clean`, `lint`, `typecheck` and `test`; Desktop also keeps `start`, `package:app` and `verify:package`. Internal orchestration and one-off operations call the owning script directly, as shown below and in [testing.md](testing.md) and [release.md](release.md).

| Root entry | Result | Effects |
|---|---|---|
| `pnpm build:vscode` | Complete extension build files | Rebuilds shared dependencies and extension JS; no Desktop or GUI |
| `pnpm build:desktop` | Desktop exe and its runtime files | Builds JS/renderer and Rust; does not launch |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | One quality target across packages | No Rust or GUI workflow |
| `pnpm check` / `pnpm check:vscode` | Quality gate for both products, or shared code plus the extension | Rebuilds selected JS outputs, not the Desktop exe; no Rust or GUI |
| `pnpm package:vsix` / `pnpm verify:vsix` | Create a VSIX / check an existing VSIX | Packaging rebuilds the extension; verification does not build; neither launches |
| `pnpm package:desktop` / `pnpm verify:desktop` | Create a ZIP / test an existing ZIP | Packaging rebuilds the complete app; verification opens isolated test windows |
| `pnpm test:desktop:manual` | Packaged app for human acceptance | Opens a window with controlled Pi and temporary data; no model requests |
| `pnpm version:set <version>` | Product version in the extension manifest | Edits that manifest; does not publish |
| `pnpm clean` | Remove package outputs and `artifacts/` | Deletes generated files, not Rust caches or user profiles |

The JavaScript-only build used by the gates is an internal tool, not a root entry. From the repository root, `node scripts/build.mjs [--scope all|vscode|desktop]` prepares the shared client once and then compiles only JavaScript/renderer outputs for the selected products; it never runs Rust. `pnpm check` and `pnpm check:vscode` call it, so the ordinary gate needs neither the Rust toolchain nor a window. A complete Desktop build runs this same JavaScript step before Rust, then refreshes the backend and Pi extensions beside the executable.

Do not add a package script for a single internal step. When a task needs a JS-only Desktop refresh, a Rust check or a test runner, run the owning script directly rather than introducing another alias.

## Product-local work

| Work | Entry | What it includes |
|---|---|---|
| Build the VS Code extension | `pnpm build:vscode` or `pnpm --dir apps/vscode build` | Shared dependencies and the complete extension JS output; not Desktop |
| Debug the extension | `.vscode/launch.json` | The `build:debug` pre-launch task runs `pnpm build:vscode` and sets `FROSTPI_SOURCEMAP=1` for Host source maps/unminified output; production output stays minified for the bundle budget |
| Check shared types | `pnpm --dir apps/pi-client typecheck` | Separate core/shared/UI environment checks. Package-local `test` covers backend/host behavior; shared UI component tests use the vscode package's DOM infrastructure, as described in testing.md |
| Build Desktop | `pnpm build:desktop` or `pnpm --dir apps/desktop build` | JS/renderer plus the Rust release executable at `apps/desktop/src-tauri/target/release/frostpi-desktop.exe`; requires the native toolchain below |
| Compile only Desktop JS/renderer | `node scripts/build.mjs --scope desktop` | Internal build for checks/tooling; writes `dist/`, not a runnable release directory or a new exe |
| Run Desktop for development | `pnpm --dir apps/desktop start` | Launches the existing executable with a separate FrostPi development profile; it does not build |

VS Code remains in its workspace Extension Host, including remote workspaces. Do not move its process placement or require a Desktop launch to develop an editor integration. Use `.agents/skills/dual-maintenance/SKILL.md` to decide whether a shared change needs Desktop adaptation, and `.dev/docs/testing.md` to select verification.

Desktop's `start` command defaults to `%APPDATA%/FrostPi-Dev`; a normal packaged-executable launch defaults to `%APPDATA%/FrostPi`. Both keep an explicit `FROSTPI_DESKTOP_USER_DATA` override. The profile includes FrostPi settings, Project/session indexes and WebView2 storage. No existing profile is copied, migrated or cleared. Directly double-clicking the build-output exe bypasses the development launcher and uses the normal profile unless the environment overrides it; use `start` for development isolation rather than relying on debug/release compilation mode.

Development isolation changes only FrostPi storage. It must not set or replace Pi's agent directory, session directory, credentials, extensions or skills. Development therefore uses normal Pi history/configuration unless the caller explicitly overrides them. Automated tests remain distinct: temporary FrostPi/Pi directories and controlled children, not real user configuration. Settings import and state/reopen behavior are contracts in `apps/desktop/SPEC.md`, not extra development steps.

A complete Desktop build requires Windows x64, the stable Rust MSVC toolchain and Visual Studio C++ build tools/Windows SDK. Running Desktop additionally requires Node 22.19+, Pi and WebView2 Runtime. Ordinary `check` and `check:vscode` need neither Rust nor those runtime installations.

```bash
pnpm build:desktop
pnpm --dir apps/desktop start
```

The executable embeds the renderer: renderer changes need a complete Desktop build, and a JS-only build leaves the existing executable serving the previous UI. Native shell, launch, resource or packaging changes also need the Rust checks, GUI smoke or packaged verification selected in [testing.md](testing.md).

For real-browser client UI checks, use the [CDP workflow](testing.md#real-client-ui-interaction).

## Setting definitions

FrostPi schemas/defaults are authored in `apps/vscode/package.json` under `contributes.configuration`. Shared runtime defaults and browser-safe setting definitions are generated from that source. Run the generator from the repository root:

```bash
node apps/pi-client/scripts/generate-setting-defaults.mjs
node apps/pi-client/scripts/generate-setting-defaults.mjs --check
```

The first command rewrites `apps/pi-client/src/core/configuration/frostPiSettingDefaults.generated.ts` and `apps/pi-client/src/shared/configuration/frostPiSettingDefinitions.generated.ts`; `--check` fails when they are stale. The shared-client build runs that check, so stale generated files fail both product builds. Include generated changes with the schema edit, and do not hand-edit the generated files. Both product builds consume these modules, not the product manifest, so a hand-maintained host-local fallback table is not a substitute.

Generation does not implement a new setting. Wire its parsing, behavior and applicable host support, then verify the affected path. Native VS Code settings such as `chat.*`, `editor.*` and exclusion maps are not FrostPi manifest definitions. Desktop's import whitelist and original-key storage are owned by its settings contract.

## Shared source resolution

Product TypeScript, Vite, Vitest and esbuild mappings must select the same `apps/pi-client` implementation. Backend exports use built JS/declarations; browser builds consume exported Svelte/CSS source. Preserve the separate environment entries rather than introducing a root barrel that mixes browser and Node modules. Shared code declares its own runtime/type dependencies.

Each product's own JS compilation lives in `apps/vscode/build.mjs` and `apps/desktop/build.mjs`. These are internal files invoked by the root JavaScript orchestrator; they are not package entries. Desktop's complete build script (`apps/desktop/scripts/build.mjs`) runs that JavaScript step and then Tauri/Cargo.

Both products bundle the common `apps/pi-client/pi-extensions` sources into their outputs. Shared styles use one common entry, and vendor/font URLs must retain their entry-relative layout. A copied implementation or separately maintained asset list would require manual propagation and defeat the shared-source maintenance model. Source ownership is mapped in `.dev/docs/feature-map.md`; environment constraints are in `apps/pi-client/SPEC.md`.

The independent `packages/provider-usage` engine has its own package-local checks. Versioning and publication are handled by `.dev/docs/release.md`, not by editing package versions during ordinary development.
