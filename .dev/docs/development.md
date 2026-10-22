---
title: Development Workflow
description: Workspace setup, independent product builds, shared-client ownership, and debugging.
scope:
  - /**
updated: 2026-10-22
---

# Development Workflow

Use Node 20.19+ and pnpm 10. The Electron development host and a manually tested Pi executable can have newer Node requirements than the extension build runtime.

Install from the repository root with `pnpm install --frozen-lockfile`. The lockfile covers all workspaces; never install independently inside an app. Root `check`/`build` orchestrate the client, both products, RPC and provider-usage packages. Each package owns its local scripts.

## Product-local work

- `pnpm --dir apps/vscode build` builds the shared client/RPC/provider dependencies and the extension only. It does not build or launch Desktop; the existing VS Code debug task remains sufficient.
- `pnpm --dir apps/pi-client <typecheck|lint|test>` checks shared application behavior, concentrated host contracts and browser UI. Core/shared/UI have separate environment checks. Host-independent tests isolate Pi settings and use explicit fake host services, not VS Code mocks.
- `pnpm --dir apps/desktop build` builds the Electron main/preload and a renderer consuming the same ClientApp. `pnpm --dir apps/desktop start` launches the development preview; directories may be passed as arguments or added in the UI.
- `pnpm --dir apps/desktop test:smoke` requires a current Desktop build. It launches real Electron with isolated fake Pi children, two temporary unrelated Projects and a temporary Electron/Pi profile; it never uses real model credentials. It prints the result and OS-temporary screenshot/log location. This is not real-Pi acceptance.

Desktop is a development preview with persistent settings but memory-only Projects and client session metadata. Normal starts retain the system application-data `FrostPi` profile; set `FROSTPI_DESKTOP_USER_DATA` to an isolated directory when testing. First-run setup offers a whitelist import from the default VS Code user settings or initialization with defaults. Import is an editable preview until Save, not ongoing synchronization. Settings can be edited in the app or opened in the system editor and explicitly reloaded. See the [Desktop contract](../../apps/desktop/SPEC.md#settings-and-initial-import).

Closing the preview still disposes its child processes. Persistent settings do not establish app-reopen/session/draft/background behavior; Pi-owned conversation persistence remains separate. Automated tests and smoke use temporary profiles and synthetic VS Code settings, never real user settings.

Both Electron launchers remove `ELECTRON_RUN_AS_NODE` only from the launch environment. Do not modify Pi's process policy to compensate for an Electron launcher variable. Electron's executable must be available before launch; a JS package install or successful renderer build alone does not prove native launch.

## Setting definitions

Edit FrostPi setting schemas/defaults in [`apps/vscode/package.json`](../../apps/vscode/package.json) under `contributes.configuration`. Run `pnpm --dir apps/pi-client settings:generate` and commit the generated runtime defaults and browser-safe setting definitions with that change. Do not edit generated defaults or add host-local fallback tables. Shared code consumes the generated module, not the product manifest at runtime.

`pnpm --dir apps/pi-client settings:check` rejects stale output; both product builds reach this check through the shared-client build. The shared configuration test also checks schema/default parity. New keys still need their behavior wired into shared parsing and applicable host support; generating defaults does not implement a setting or establish Desktop compatibility.

## Ownership and source resolution

- `apps/pi-client/src/core`: one-session Runtime/state/projection and Pi/OMP policy.
- `src/host`: shared Registry, history discovery/pickers, bridge and finite `clientHost.ts` interface.
- `src/shared`: serializable models and messages; `src/ui`: shared Svelte/browser implementation.
- `apps/vscode`: real VS Code adapter/editor integration and native browser startup. `apps/desktop`: Electron adapter, Project navigation and finite preload.
- `apps/pi-client/pi-extensions`: shared Pi-side tree/Question artifact sources; both products bundle them into their own output.

Product TypeScript/Vite/Vitest/esbuild mappings resolve the same shared sources. Core/shared/host default package exports refer to built JS/declarations; UI exports Svelte/CSS source for the consuming browser build. Shared code declares its own runtime/type dependencies. Do not introduce stale copied implementations or a shared root barrel mixing browser and Node modules.

Launch the extension with `.vscode/launch.json`. `build:debug` sets `FROSTPI_SOURCEMAP=1` for source maps/unminified Host output; regular production bundles stay minified for the bundle budget. Preserve remote workspace Extension Host placement.

`packages/provider-usage` retains its independent credential/query engine; run its package-local scripts for changes there. Product versions still change only through the root version workflow; see [release](release.md).
