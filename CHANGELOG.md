# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-07-25

### Added

- Add an optional FrostPi-bundled Pi `question` tool (off by default via `frostpi.questionTool.enabled`) that renders clarification prompts inside the Webview and returns structured answers through the standard Pi Extension UI response. The bundled extension is injected only into newly started or restarted Pi processes; project/global `question` registrations keep Pi's load-order priority. Document that third-party question extensions can inspect `PI_INSIDE_FROSTPI` to skip their own registration when users prefer FrostPi's bundled tool.
- Inject `PI_INSIDE_FROSTPI` and `PI_INSIDE_FROSTPI_VERSION` environment variables into every Pi child process so Pi extensions can detect they are running under FrostPi.

### Changed

- Extract shared content max-width and composer editor size constants into CSS variables.
- Densify the Question tool panel (header, tabs, options, review rows, and action bar) and limit its expanded height so more conversation remains visible while answering; custom-answer and overall-note textareas now start at a single line and can still be resized vertically.
- Collapse the work trace of settled turns that ended abnormally: aborted turns now use a "Stopped" header and error turns use a "Failed" header (previously stayed fully expanded). Also fold turns that were interrupted mid-tool or before the assistant produced a final response; in that case the last activity is treated as the visible outcome and the break label is "Last step". The running turn remains flat.

### Fixed

- Keep the composer width constrained when expanded so it grows upward instead of stretching to full viewport width.

## [0.8.0] - 2026-07-24

### Added

- Branch a conversation from any completed user message with **Branch here**, which edits and resubmits the prompt in the same Pi session and FrostPi session file.
- Switch existing branches through a grouped VS Code QuickPick that shows current/other paths, message count, last update, and a bounded ending preview.
- Represent branch points as centered timeline milestones in the conversation view.
- Show Pi session-tree adapter availability in the Session actions menu; activating it performs a fresh capability probe.
- Package the private session-tree Pi extension as `dist/pi-extensions/session-tree.js` and inject it per Runtime with an isolated token and temporary result directory.
- Constrain Markdown inline-code file links to known text extensions so unrelated code tokens are not treated as file references.

### Changed

- Keep **Fork** as a distinct workflow that creates an independent FrostPi/Pi session while reusing the same composer seed extraction.

### Fixed

- Refresh context and session stats during active turns instead of only when a turn settles.

## [0.7.2] - 2026-07-24

### Added

- Open Markdown file links and exact inline-code file references in VS Code, including line, column, and line-range navigation resolved from the active session working directory.

### Changed

- Keep plain-text filenames as text instead of automatically rendering them as links.

## [0.7.1] - 2026-07-23

### Added

- Follow VS Code Chat `fontFamily`, `fontSize`, `editor.fontFamily`, and `editor.fontSize` settings for conversation messages and the composer.

### Changed

- Make composer `Tab` and `Shift+Tab` indent and outdent by two spaces, and continue simple `-` and `*` Markdown lists when pressing `Enter`.

## [0.7.0] - 2026-07-22

### Added

- Run Pi sessions in existing same-repository Git worktrees from one VS Code window. New offers a worktree picker when more than one is available; Resume discovers sessions across those worktrees. FrostPi does not create, delete, or manage worktrees.

### Changed

- Mark sessions outside the open workspace folders with a compact directory capsule on the status line.
- In Resume, list linked-worktree groups before the current workspace, ordered by recent activity, and use a branch icon on worktree rows.

### Fixed

- Show Pi provider and authentication errors in live and restored conversations when the failed assistant message contains no response text.
- Keep user-message code blocks inside the Webview while preserving horizontal scrolling within the code block.

## [0.6.2] - 2026-07-21

### Added

- Complete workspace files and directories through `@` using bounded, query-driven `fd` searches; selecting a directory continues completion within it.

### Changed

- Replace the cached 50,000-path mention catalog with cancellable per-query searches that respect ignore files, VS Code excludes, and configurable symlink handling.

### Fixed

- Keep file completion available with fd versions older than 10 while disabling unsupported directory rows, warn once about upgrading, and stop searches that exceed seven seconds.

## [0.6.1] - 2026-07-21

### Changed

- Let `Tab` accept the highlighted `/` and `@` completion option in the composer.
- Move Extension UI dismiss from a bottom Cancel button to a top-right close control on `select`, `input`, and `editor` cards.

### Fixed

- Keep the open-session dropdown order stable while multiple sessions stream; stop re-sorting by high-frequency view updates, and pick the most recently opened remaining session when the active one closes.
- Keep turn traces visible while Pi continues through tool iterations; collapse them only after the agent run settles, with the full turn duration.
- Honor Pi extension `set_editor_text` by replacing the session composer draft instead of appending through the selection-insert path.
- Keep composer text filled by extension commands such as `/input-file` after submit: clear the draft on send, and do not clear it again when `promptResult` succeeds.

## [0.6.0] - 2026-07-20

### Added

- Add a local `/editor` command that opens the composer draft in a temporary markdown tab and writes the saved buffer back when the tab closes.
- Add a composer expand control that fills the FrostPi panel for long drafts; Escape or the same control restores the normal layout.
- Collapse completed-turn tool, reasoning, and interim replies into one "Worked" summary above the final reply, with a labeled Reply break (`frostpi.conversation.collapseTurnTrace`, default on).

### Changed

- Move single-owner Webview styles into component-scoped Svelte stylesheets, and split remaining global CSS into `tokens`, `sessions`, `composer`, and `pickers` sheets for clearer ownership.

## [0.5.0] - 2026-07-20

### Added

- Render KaTeX math (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) and complete Mermaid fences in conversation messages. Incomplete Mermaid fences stay as source text while streaming.
- Copy the original Markdown text from user messages and individual assistant responses.
- Fork a conversation from any completed user message using its exact Pi session entry. FrostPi keeps the original session and Composer draft, opens a temporary named fork, and restores the selected text and images for editing before submission.

### Fixed

- Keep ModelPicker and Thinking Level menus compact and anchored within narrow VS Code sidebars, and keep the current model visible when opening ModelPicker.
- Keep the composer within the available Webview width when multiple images are pasted; compact attachment cards now keep filenames, sizes, and remove actions visible.

## [0.4.2] - 2026-07-19

### Fixed

- Prevent the model picker from auto-scrolling back to the current model when expanding or collapsing other provider groups; the initial scroll now only happens on first open.

## [0.4.1] - 2026-07-18

### Changed

- Custom proxy now uses one endpoint in Settings and the guided wizard. `host:port` or `http(s)://…` covers both HTTP and HTTPS traffic; `socks5://…` sets the SOCKS proxy. Older split `http` / `https` / `all` values are still read when the new endpoint is empty.

### Fixed

- Extension slash commands with arguments (for example `/toggle-web-proxy status`) run instead of being sent to the model when the separator after the command is a special space such as a non-breaking space.
- Resume discovers sessions when Pi `sessionDir` is a workspace-relative path such as `.pi/sessions`.
- Early auto-generated session titles stay visible after long follow-up turns; later renames still win.
- The model picker opens on the current model and keeps that row in view when space allows.

## [0.4.0] - 2026-07-18

### Added

- Show an ephemeral "Compacting context" status while `/compact` runs.
- Show follow-up prompts accepted during an active run as temporary "Queued" bubbles, then promote them into the conversation when Pi accepts them. Clear the queue on abort, stop, or process failure.
- Add `@Selection` and `@CurrentFile` as top mention completion items that insert path/line references only.

### Changed

- Open FrostPi on the onboarding home when no session is selected instead of auto-creating a new session.
- Remove the composer Add Context (+) menu; use `@` mentions for editor path/line references.
- Insert editor selection as `@path:start-end` without embedding selected code.
- Tighten the context usage hover card layout and labels.
- Keep a single root `CHANGELOG.md`; packaging copies it into the extension VSIX.
- License the product as AGPL-3.0-only and mark the VS Code extension package as publishable.
- Simplify proxy setup: accept bare `host:port`, default local loopback in `NO_PROXY`, and apply a single HTTP proxy to HTTPS when HTTPS is unset.

### Fixed

- Extension slash commands with arguments complete cleanly without waiting for a model turn.
- Keep `/` and `@` completion selection in view by scrolling the option list.
- Accept bare `host:port` values in the guided proxy wizard, matching Settings.

## [0.3.0] - 2026-07-17

### Added

- Add a compact, hideable session bar with session switching, closing, background activity, and required-input indicators.
- Add explicit loading for large or previously failed conversation histories.
- Add Pi-compatible `/compact [instructions]` handling with expandable compaction records in the conversation timeline.

### Changed

- Keep running sessions active in the background when creating, resuming, or selecting another session.
- Serialize Pi process startup and conversation-history loading to limit Extension Host resource spikes, and defer automatic loading for histories larger than 8 MiB.
- Treat unused new sessions as temporary until they accept a prompt or are renamed.
- Consolidate session actions in the Webview instead of duplicating them in the VS Code View title menu.

### Fixed

- Preserve Pi events received while prior conversation history is being loaded and replaced.
- Preserve the selected Pi session file while a resumed session waits to start.
- Keep the composer anchored to the bottom when the session bar is hidden.
- Correct code-block horizontal banding by preventing double translucent background stacking in `pre > code`.
- Correct composer text flush against the edge by reclaiming padding control from the VS Code Webview default reset.
- Correct CI failure in the `Verify VSIX` job by adding the missing `pnpm build` step.

## [0.2.2] - 2026-07-17

### Changed

- Display Pi extension notifications as severity-aware, multiline notices in the owning session conversation instead of transient Webview toasts.
- Present tool input arguments as compact inline values or readable blocks, and increase composer spacing.

### Fixed

- Preserve the first-observed order of notices within active turns so retries and extension messages appear between the surrounding thinking, tool, and response activity.
- Restore the context-usage detail card on hover by preventing metrics-row clipping and removing conflicting click toggling.

## [0.2.1] - 2026-07-17

### Added

- Add turn-based streaming conversation projection, pause-aware output following, and compact reasoning, tool, and response activity views.
- Add a CodeMirror composer with slash-command highlighting, text-only `@file` completion, and workspace file indexing.
- Add compact model and thinking-level pickers, detailed context usage, and process-start proxy modes with guided configuration.

### Changed

- Use incremental Webview bridge updates with explicit compatibility validation.
- Remove hover-driven model-row reflow and normalize model, thinking-level, and command typography.

### Fixed

- Correct `@file` completion activation and expose no-result and search-error states.
- Add a Webview-safe ID fallback for environments without `crypto.randomUUID`.
- Correct CodeMirror height, scrolling, focus-border, and hidden live-region behavior.
- Correct provider collapse and expansion state, including global expand and collapse controls.

## [0.1.1] - 2026-07-16

### Added

- Add model-aware thinking-level options and a dedicated selector.
- Add existing-session discovery, resume selection, `/resume` completion, and direct JSONL browsing.

### Changed

- Rework the header, conversation, composer, menus, and popovers for narrow sidebars.
- Consolidate editor selection and current-file actions into the Add Context menu.

### Fixed

- Correct Codicon font asset resolution inside VS Code Webviews.
- Strip ANSI terminal escape sequences from extension status, widget, title, and notification text.
- Avoid using generated Pi session filenames as FrostPi titles unless Pi or the user supplies a name.

## [0.1.0] - 2026-07-16

### Added

- Add the Pi RPC subprocess client with strict JSONL framing and failure recovery.
- Add the multi-session VS Code interface with restoration, streaming conversation, tool activity, images, models, thinking levels, commands, and extension UI.
- Add editor context capture, file navigation, Git-base diffs, diagnostics export, CSP, and trusted-workspace constraints.
- Add production builds, tests, VSIX verification, release scripts, and maintenance documentation.

[Unreleased]: https://github.com/frostime/frostpi/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/frostime/frostpi/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/frostime/frostpi/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/frostime/frostpi/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/frostime/frostpi/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/frostime/frostpi/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/frostime/frostpi/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/frostime/frostpi/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/frostime/frostpi/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/frostime/frostpi/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/frostime/frostpi/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/frostime/frostpi/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/frostime/frostpi/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/frostime/frostpi/compare/v0.1.1...v0.2.1
[0.1.1]: https://github.com/frostime/frostpi/compare/10ca43a728ae697fe5b6fbfbf1bb40b607e5edcb...v0.1.1
[0.1.0]: https://github.com/frostime/frostpi/commit/10ca43a728ae697fe5b6fbfbf1bb40b607e5edcb

