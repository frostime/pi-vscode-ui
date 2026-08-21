# Composer contract

The Composer is a plain-text CodeMirror editor. FrostPi submits exactly the visible document text plus explicit image attachments; IME, selection, undo/redo, clipboard, and multiline editing remain native.

- `Enter` inserts a newline and continues/removes Markdown `-`/`*` list markers. `Tab` accepts completion or indents by two spaces; `Shift+Tab` removes up to two spaces or one tab without moving focus.
- `Ctrl+Enter` and `Cmd+Enter` submit with the session's current streaming delivery; `Alt+Enter` explicitly uses Queue without changing that selection. While idle, both start a normal prompt.
- Idle Composer chrome keeps the existing single Send action. While streaming, Stop remains fixed at the right edge; a non-empty draft reveals an adjacent split Send action whose menu selects Steer or Queue. The selection is remembered per session for the current Webview lifetime and initializes from `frostpi.composer.streamingBehavior`.
- Submission clears immediately and retains a local failure snapshot. A failed correlated result restores it only when the Composer is still empty; success never overwrites later Host/editor text. Request identifiers must remain available when `crypto.randomUUID` is unavailable. Prompts accepted while streaming remain visible as Steer or Queue bubbles until Pi injects them.
- Text is trimmed before Host handling. Unicode whitespace between a leading slash command and its arguments is normalized to one ASCII space; Pi parses the remaining arguments.
- Text-only `/compact` delegates to Pi's compact request, takes precedence over a same-named extension command, and never appends a user prompt. `/resume` and `/editor` are also Host-local.
- `/editor` allows one temporary Markdown file at a time. Closing its tab replaces the owning session's text while preserving attachments; another `/editor` reveals the existing tab.
- The expanded Composer remains expanded across updates to the active session and collapses only on session switch, explicit minimize, or Escape.
- File mentions insert only path/line text. FrostPi never reads or injects referenced file content.
- PNG/JPEG/WebP attachments remain explicit and obey prompt validation limits.
- Fork preserves the original session draft and delivers selected text/images to the new temporary session through a Host-validated, one-shot, non-persisted seed.
- In-place tree navigation uses the same seed contract under the same session id; replacing a non-empty draft requires Host confirmation, and non-editable targets preserve it.
