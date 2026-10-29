---
title: Development Workflow
description: Install the workspace, choose between root and package commands, build and launch each product, generate settings and preserve shared-source resolution.
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

## Command layers

Root commands name a whole-repository task or a product flow; packages own the concrete implementation. Use a root command when the work spans packages or mirrors a delivery step, and a package-local command as the normal starting point for an affected feature.

| Root entry | What it runs |
|---|---|
| `pnpm build` | All five packages once: the shared client builds its RPC and provider-usage dependencies, then the extension and Desktop produce their JavaScript outputs |
| `pnpm build:vscode` | Shared client, then the extension only |
| `pnpm build:desktop` | Shared client, then Desktop JavaScript and renderer only; no Rust |
| `pnpm check` / `pnpm check:vscode` | Quality gate for both products, or for shared code plus the extension |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | One quality target across packages; `lint` and `test` also cover the engineering scripts |
| `pnpm clean` | Package outputs and `artifacts/` |

Each product's `build` prepares its shared dependencies before compiling the product, so no manual dependency build is needed. Product-only `build:local` is an internal orchestration step: it assumes shared outputs already exist. Desktop's `build:native` rebuilds the JavaScript outputs and adds the Rust executable.

Root orchestration rejects an unsupported argument instead of ignoring it, so a mistyped flag cannot silently widen a build, check or clean. Quality targets run packages serially.

Use [testing.md](testing.md) to choose checks and read evidence limits, and [release.md](release.md) for delivery gates.

## Product-local work

| Work | Entry | What it includes |
|---|---|---|
| Build the VS Code extension | `pnpm --dir apps/vscode build` | Shared dependencies and extension outputs, not Desktop |
| Debug the extension | `.vscode/launch.json` | The `build:debug` pre-launch task runs `pnpm build:vscode` and sets `FROSTPI_SOURCEMAP=1` for Host source maps/unminified output; production output stays minified for the bundle budget |
| Check shared types | `pnpm --dir apps/pi-client typecheck` | Separate core/shared/UI environment checks. Package-local `test` covers backend/host behavior; shared UI component tests use the vscode package's DOM infrastructure, as described in testing.md |
| Build Desktop | `pnpm --dir apps/desktop build` | Node backend and WebView2 renderer consuming the same ClientApp; no Rust build |
| Run Desktop for development | `pnpm --dir apps/desktop start` | Run the executable from `build:native` with a separate FrostPi development profile; pass directory arguments or add Projects through its native directory picker |

VS Code remains in its workspace Extension Host, including remote workspaces. Do not move its process placement or require a Desktop launch to develop an editor integration. Use `.agents/skills/dual-maintenance/SKILL.md` to decide whether a shared change needs Desktop adaptation, and `.dev/docs/testing.md` to select verification.

Desktop's `start` command defaults to `%APPDATA%/FrostPi-Dev`; a normal packaged-executable launch defaults to `%APPDATA%/FrostPi`. Both keep an explicit `FROSTPI_DESKTOP_USER_DATA` override. The profile includes FrostPi settings, Project/session indexes and WebView2 storage. No existing profile is copied, migrated or cleared. Directly double-clicking the build-output exe bypasses the development launcher and uses the normal profile unless the environment overrides it; use `start` for development isolation rather than relying on debug/release compilation mode.

Development isolation changes only FrostPi storage. It must not set or replace Pi's agent directory, session directory, credentials, extensions or skills. Development therefore uses normal Pi history/configuration unless the caller explicitly overrides them. Automated tests remain distinct: temporary FrostPi/Pi directories and controlled children, not real user configuration. Settings import and state/reopen behavior are contracts in `apps/desktop/SPEC.md`, not extra development steps.

Native builds require Windows x64, the stable Rust MSVC toolchain, Visual Studio C++ build tools/Windows SDK, and installed WebView2 Runtime. Node 22.19+ and Pi remain external runtime prerequisites.

```bash
pnpm --dir apps/desktop build:native
pnpm --dir apps/desktop start
```

`build:native` rebuilds the JavaScript outputs and produces the release executable that `start` launches. The executable embeds the renderer, so renderer changes need this rebuild rather than a JS-only build. Native shell, launch, resource or packaging changes also need the Rust checks, GUI smoke or packaged verification selected in [testing.md](testing.md).

For real-browser client UI checks, use the [CDP workflow](testing.md#real-client-ui-interaction).

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
