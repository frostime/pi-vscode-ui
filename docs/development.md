---
title: Development Workflow
description: Local setup, build topology, debugging, and change discipline.
scope:
  - /**
updated: 2026-07-27
---

# Development Workflow

Use Node 20.19+ and pnpm 10. The Pi executable used for manual testing may require a newer external Node; this is independent of the extension build runtime. Install dependencies only from the repository root; the shared lockfile covers the root, `apps/*`, and `packages/*`.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Each workspace package owns its local `build`, `clean`, `lint`, `typecheck`, and `test` implementation. Root commands only orchestrate those package scripts and release artifact checks. Add shared development tools with `pnpm add -Dw <package>`; add package dependencies with `pnpm --filter <workspace-name> add <package>`.

Launch the Extension Development Host with the repository's `.vscode/launch.json`. The extension bundle is built by esbuild; the Svelte Webview is built by Vite. Production builds omit source maps unless `FROSTPI_SOURCEMAP=1` is set.

Protocol work starts in `packages/pi-rpc`; lifecycle orchestration starts in `SessionRuntime`; persisted-tree, conversation, and session-scalar work starts in `SessionEntryState`, `ConversationProjection`, and `SessionViewState` respectively. Rendering work starts in the relevant Webview feature. Do not pass raw Pi events or session entries through the bridge to “save time.”

When behavior is ambiguous, compare the current Pi RPC documentation and source, PiDeck's process/session UX, and `pi-acp`'s event translation. External implementations are references, not runtime dependencies; preserve their licenses and avoid copying incompatible code.
