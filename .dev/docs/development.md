---
title: Development Workflow
description: Workspace setup, package ownership, debugging, and source entry points.
scope:
  - /**
updated: 2026-07-28
---

# Development Workflow

Use Node 20.19+ and pnpm 10. A manually tested Pi executable may require a newer external Node than the extension build runtime.

Run `pnpm install --frozen-lockfile` from the repository root, then use `pnpm check` and `pnpm build` as needed. The shared lockfile covers all workspaces; never install independently inside a package.

Packages own local `build`, `clean`, `lint`, `typecheck`, and `test` scripts; root commands only orchestrate them. Add shared tools with `pnpm add -Dw <package>` and package dependencies with `pnpm --filter <workspace-name> add <package>`.

Launch the Extension Development Host with `.vscode/launch.json`. esbuild bundles the extension and Vite builds the Webview; production source maps require `FROSTPI_SOURCEMAP=1`.

Start transport work in `packages/pi-rpc`, lifecycle work in `apps/vscode/src/extension/sessions/`, projection work in `apps/vscode/src/extension/conversation/`, and rendering work in the owning Webview feature. Preserve adjacent SPECs and never bridge raw Pi events or entries.
