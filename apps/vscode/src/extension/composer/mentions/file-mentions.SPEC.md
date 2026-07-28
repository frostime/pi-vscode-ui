# File mentions

`@path` is a text-only Pi-compatible reference. FrostPi never reads or injects the referenced file or directory into the prompt.

- Typing `@` with an empty or matching query lists built-in specials first: `@Selection` (`@path:start-end`, current line when the selection is empty) and `@CurrentFile` (`@path`). Both insert path/line references only.
- The Extension Host searches only the active session working directory by invoking `fd` from PATH or Pi's managed bin directory. It prefers the first discovered fd 10.0.0 or newer. If only an older version exists, file completion remains available, directory rows are disabled, and VS Code warns once on first use. Missing `fd` is reported in the completion menu.
- Each query starts a fresh, bounded fd process; a newer query terminates the previous process. Searches time out after 7 seconds. No workspace path catalog is retained.
- With fd 10.0.0 or newer, searches include files and directories. Searches respect ignore files by default, apply `files.exclude`, and additionally apply `search.exclude` unless disabled. `.git` and `node_modules` are always excluded.
- Ranking favors exact names, prefixes, path segments, fuzzy subsequences, active/visible editors, and files touched in the current session. At most 500 fd results are ranked; only the requested top candidates cross the Host–Webview bridge.
- Selecting a directory inserts a trailing slash and continues completion. For quoted paths, the cursor remains before the closing quote. Selecting a file finishes the mention with a space.
- Paths are inserted relative to the Pi session CWD. Whitespace uses `@"path with spaces"`.
