---
title: Development Workflow
description: Workspace setup, product builds and startup, settings generation and shared-source resolution.
scope:
  - /**
updated: 2026-10-29
---

# Development Workflow

## Workspace setup

Use Node 20.19+ and the repository's pnpm 10 version. Install once from the repository root:

```bash
pnpm install --frozen-lockfile
```

The root lockfile covers all packages; do not create app-local installations or lockfiles. Package scripts expose common tasks, not every internal step. Packages own `build`, `clean`, `lint`, `typecheck` and `test`; root entries provide product flows and workspace checks. Use existing scripts or tools directly for specialized work instead of adding aliases.

Root lint/typecheck/test span the packages. `pnpm clean` removes package outputs and `artifacts/`, not Rust caches or user profiles.

## Product-local work

Commands below run from the repository root. Choose checks in [testing.md](testing.md) and packaging/publication in [release.md](release.md).

| Task | Entry | Result |
|---|---|---|
| Build the extension | `pnpm build:vscode` | Shared dependencies and extension JS; no Desktop work |
| Build Desktop | `pnpm build:desktop` | JS/renderer, Rust exe and current backend/Pi extensions beside the exe; does not launch |
| Run Desktop | `pnpm --dir apps/desktop start` | Launches the existing exe with the development profile; does not build |
| Debug the extension | `.vscode/launch.json` | `build:debug` runs the extension build with `FROSTPI_SOURCEMAP=1` for Host maps/unminified output; production stays minified for the bundle budget |

The product-local `pnpm --dir apps/vscode build` and `pnpm --dir apps/desktop build` have the same complete-build behavior as the root shortcuts. Desktop's exe is `apps/desktop/src-tauri/target/release/frostpi-desktop.exe`. Native compilation requires Windows x64, Rust MSVC and Visual Studio C++ build tools/Windows SDK. Running Desktop additionally requires Node 22.19+, Pi and WebView2; Pi can impose a newer Node minimum.

For Rust-free checks or JS-only tooling, use `node scripts/build.mjs --scope desktop`; scope can also be `vscode` or `all` (the default). It prepares shared dependencies once and writes selected JS outputs to `dist/`; it does not rebuild the exe or refresh its sibling resources. The renderer is embedded in the exe, so GUI checks after renderer changes need a complete Desktop build. Ordinary `check` and `check:vscode` use this internal JS build and need neither Rust nor GUI runtimes.

`start` defaults to `%APPDATA%/FrostPi-Dev`; a packaged launch or direct double-click of the build exe uses `%APPDATA%/FrostPi`. Both honor `FROSTPI_DESKTOP_USER_DATA`. These profiles hold FrostPi settings, Project/session indexes and WebView2 data. The launcher only selects FrostPi storage: it does not redirect Pi history/configuration/extensions/skills, copy credentials, or copy/migrate/clear profiles. Automated tests instead use temporary FrostPi/Pi data; see the [Desktop contract](../../apps/desktop/SPEC.md) for state and import rules.

VS Code keeps Pi in its workspace Extension Host, including remote workspaces. Editor integration must not require a Desktop build or launch. Use [dual-maintenance](../../.agents/skills/dual-maintenance/SKILL.md) to select source ownership and cross-product verification.

## Setting definitions

`apps/vscode/package.json` (`contributes.configuration`) owns FrostPi definitions/defaults. After editing it, run:

```bash
node apps/pi-client/scripts/generate-setting-defaults.mjs
node apps/pi-client/scripts/generate-setting-defaults.mjs --check
```

Include generated changes; do not hand-edit them. The shared-client build rejects stale output, and both products consume generated modules rather than reading the product manifest or maintaining fallback tables. Generation updates definitions, not behavior: wire parsing and applicable hosts separately.

Native VS Code keys such as `chat.*`, `editor.*` and exclusion maps are not FrostPi definitions. Desktop's import whitelist and original-key storage follow its module contract.

## Shared source resolution

TypeScript, Vite, Vitest and esbuild must select the same `apps/pi-client` implementation. Backend exports use built JS/declarations; browser builds use Svelte/CSS source. Preserve separate environment entries rather than a barrel mixing browser and Node modules. Shared code declares its own runtime/type dependencies.

Both products bundle `apps/pi-client/pi-extensions` and use the common styles entry. Keep vendor/font URLs entry-relative; copied implementations or separate asset lists create propagation work. [feature-map.md](feature-map.md) locates the build owners; [apps/pi-client/SPEC.md](../../apps/pi-client/SPEC.md) defines environment boundaries.
