# AGENTS.md

FrostPi is a VS Code workspace extension and direct Pi RPC client.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm package:vsix && pnpm verify:vsix
```

During unit testing in code development, prioritize local testing to avoid the inefficiency of full-scale testing (e.g., `pnpm --dir apps/vscode exec vitest run ...`).

For commands where only the result matters, print only the tail or even just the exit code, and redirect stdout to a temporary file.

## Navigation

- When you know **what** feature to change but not **where**: start with [`docs/feature-map.md`](docs/feature-map.md) — feature→code index.

## Maintenance

- Use [`docs/index.md`](docs/index.md) as the documentation entry point. Before changing architecture, protocol, session state, bridge behavior, or UI interaction, read the linked topic document and the nearest `*.SPEC.md`.
- Follow [`docs/development.md`](docs/development.md) for workspace dependencies and package scripts. Install from the repository root; packages own local scripts, while root scripts only orchestrate them.
- Follow [`docs/testing.md`](docs/testing.md) for verification scope and [`docs/release.md`](docs/release.md) for versions, packaging, tags, and GitHub Actions. Change the product version only with `pnpm version:set <version>`.
- Update the relevant document in the same change when a durable command, boundary, workflow, or release rule changes. Keep `AGENTS.md` brief and link detailed procedures instead of duplicating them.
- Top-level `docs/` is reserved for cross-module constraints and workflows; module-specific behavior belongs in the nearest `*.SPEC.md`.

## Boundaries

- `packages/pi-rpc`: child process, JSONL framing, request/response mechanics. No VS Code dependency.
- `apps/vscode/src/extension`: VS Code APIs, session/process policy, Pi event projection.
- `apps/vscode/src/shared`: serializable contracts and pure helpers only.
- `apps/vscode/src/webview`: Svelte/browser code. No Node or `vscode` imports.
- Raw Pi events must not reach Webview components.
- One `SessionRuntime` owns one Pi process. Do not add a global concurrency lock.
- FrostPi never intercepts Pi file writes or injects `@file` contents.
- Proxy changes apply only after session process restart; never silently interrupt a running turn.
- Webview CSS: component-private chrome lives in that Svelte component's scoped `<style>`; keep shared primitives, design tokens/variables, cross-tree layout (`:has`, shell), and body-mounted surfaces (e.g. CodeMirror tooltips) in `apps/vscode/src/webview/styles/` (`tokens.css`, `sessions.css`, `composer.css`, `pickers.css`, plus markdown/motion/theme sheets). Do not grow feature-only rules back into the global bags.

## Change discipline

Preserve adjacent `*.SPEC.md` contracts. Add tests for protocol/state behavior, not implementation call order. Keep UI usable at 280px width and under VS Code light/dark/high-contrast themes. Do not log prompts, responses, image bytes, credentials, or unredacted proxy URLs.
