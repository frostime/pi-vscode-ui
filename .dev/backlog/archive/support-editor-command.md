---
created: 2026-07-20
status: done
branch: wip/composer-editor
feasibility-study: conducted
---

# Built-in `/editor` command

## Goal

Open the current composer draft in a VS Code editor tab; when that tab closes, replace the session's composer text with the buffer contents.

## Semantics (accepted)

- Local FrostPi slash (same class as `/resume`), never a Pi prompt.
- Prefill = submission text with the leading `/editor` token removed.
- Carrier: one temp `frostpi-composer-*.md` file in the OS temp dir (Pi external-editor shape), opened in the current window.
- Close tab = read file from disk and apply (trailing newline stripped). Save keeps edits; Don't Save discards them back to the last saved/prefill contents.
- Write-back replaces draft **text** only; image attachments are preserved.
- Bound to the `sessionId` captured at open; inactive sessions still receive their draft update.
- At most one pending tab; a second `/editor` reveals it and toasts.

## Also delivered

- Panel-internal CodeMirror expand (Zed-style): top-right control fills the FrostPi panel; Escape restores. Local Webview state only.

## Out of scope

- Command Palette entry, custom tab title scheme, `$EDITOR` spawn.

## Implementation anchors

- `apps/vscode/src/webview/features/composer/editorCommand.ts`
- `apps/vscode/src/extension/editor-context/ComposerExternalEditor.ts`
- Bridge: `openComposerEditor` / `setComposerText` (`BRIDGE_VERSION` 2.6)
- Expand: `Composer.svelte` + `.composer-expanded` styles in `tokens.css`
