# Contributing

FrostPi is a Pi GUI with a primary VS Code extension and a Desktop App maintained alongside it. Use `AGENTS.md` for project boundaries and `.dev/docs/index.md` to find the guide for the task. Before changing behavior, read the affected module's SPEC with its code.

Choose checks by the responsibility being changed. `.agents/skills/dual-maintenance/SKILL.md` routes source ownership and the first focused checks; `.dev/docs/testing.md` defines test ownership, broader gates and what each result proves. VSIX or Desktop packaging belongs to the corresponding delivery path in `.dev/docs/release.md`, not every documentation or local UI edit.

RPC framing, session lifecycle, extension UI, persistence and Host–UI synchronization changes need behavior tests and any affected contract update. Preserve keyboard/focus behavior, narrow layouts, themes and reduced motion for UI changes; cross-feature rules are in `.dev/docs/design/ui-spec.md`.

Do not add a Pi tool proxy, global session execution lock, provider credential store, custom TUI emulator or new persisted content without an explicit product decision and the corresponding contract change. A passing test or local checkpoint is not permission to merge or publish.
