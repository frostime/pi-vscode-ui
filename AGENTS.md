# AGENTS.md

FrostPi is a GUI for Pi (`pi-coding-agent`). It uses Pi's native RPC mode for conversation, tool output and session interaction; Pi remains responsible for agent execution, model requests and conversation files.

The project has two parts: a VS Code extension as the primary product, and a Desktop App maintained alongside it. Both use the application implementation in `apps/pi-client`. VS Code is the reference environment; Desktop adapts the required host services and adds its own outer UI. VS Code-only development must not require understanding, building or running Desktop.

## Start from the task

- Find a feature's source and contract in [`.dev/docs/feature-map.md`](.dev/docs/feature-map.md).
- Use [`.dev/docs/index.md`](.dev/docs/index.md) for architecture, development, testing, UI and release guidance. Read the relevant topic and nearest module SPEC, not the entire documentation tree.
- Use [dual-maintenance](.agents/skills/dual-maintenance/SKILL.md) to choose source ownership, Desktop adaptation and focused verification.
- `.dev/changes/` and `.dev/backlog/` hold task context and history, not current module contracts. Read them when working on the corresponding change.

## Tooling traps

- Install workspace dependencies from the repository root, not inside an app. Packages own local scripts; root scripts orchestrate them. See [development](.dev/docs/development.md).
- FrostPi setting definitions/defaults come from `apps/vscode/package.json`. After changing them, run `pnpm --dir apps/pi-client settings:generate` and include the generated files; builds reject stale output. Native VS Code settings have a separate source.
- Change product versions only with `pnpm version:set <version>`; follow [release](.dev/docs/release.md) for packaging and publication.

## Hard boundaries

- Shared client runtime code (`apps/pi-client/src/core` and `src/host`) must not import VS Code, Electron or product entries. Host services go through the finite `src/host/clientHost.ts` interface so both products can consume the same application.
- `src/shared` contains serializable contracts and pure helpers, not Node/core/host runtime code. `src/ui` is browser-only: no Node, native host APIs or client backend imports. UI consumes projected models, never raw Pi events. Desktop renderer authority stays behind the finite preload bridge.
- One `SessionRuntime` owns one Pi child. Do not globally serialize agent turns, intercept Pi file writes or inject `@file` contents; Pi owns execution and conversation persistence.
- Proxy changes apply to new or explicitly restarted Pi processes. Never silently interrupt a running turn to apply them.
- Do not put prompts, responses, image bytes, credentials or unredacted proxy URLs in logs or diagnostics. Pi owns provider credentials; FrostPi must not introduce another provider credential store.

Keep durable documentation and the affected module contract current with the change. Put module-specific rules beside their code and cross-module guidance in `.dev/docs/`; do not grow local procedures back into this root file.
