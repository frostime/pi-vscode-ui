---
title: Conversation Markdown Rendering
description: Sanitization, file references, streaming Mermaid, and source-text copy behavior.
scope:
  - /apps/vscode/src/webview/features/conversation/markdown/**
updated: 2026-08-28
---

# Conversation Markdown Rendering

- Ordinary Markdown uses `markdown-it` with raw HTML disabled, then sanitizes output. Mermaid uses strict security, sanitizes SVG, and fails closed without injecting raw output.
- Explicit Markdown file links and whitelisted inline-code references open through validated `openFile`; supported locations include line, column, line-range, and GitHub `#L` forms. HTTP(S) remains external.
- Incomplete Mermaid fences remain source text while streaming; only complete fences mount a diagram, and render failure shows the error plus original source.
- Fenced code blocks get a hover copy button (injected by `MarkdownHtml.svelte`, not part of sanitized HTML). It copies the block's raw code text through `copyText` and confirms in place briefly.
- Fence chrome: the outer `pre` clips and hosts the hover chrome; the inner `.code-scroll` scrolls. Prose-like languages (`txt`, `text`, `plaintext`, `md`, `markdown`, `tex`, `latex`) wrap by default; other and untagged fences scroll horizontally.
- Copy uses original protocol text in order, never rendered HTML, SVG, math markup, images, reasoning, tools, or notices.
