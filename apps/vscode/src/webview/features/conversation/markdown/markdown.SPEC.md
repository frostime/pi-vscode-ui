---
title: Conversation Markdown Rendering
description: Sanitization, file references, streaming Mermaid, and source-text copy behavior.
scope:
  - /apps/vscode/src/webview/features/conversation/markdown/**
updated: 2026-08-28
---

# Conversation Markdown Rendering

- Ordinary Markdown uses `markdown-it` with raw HTML disabled, then sanitizes output. Mermaid uses strict security, sanitizes SVG, and fails closed without injecting raw output.
- Markdown image syntax renders an inert sanitized placeholder before any source is activated. Relative paths resolve from the displayed Session cwd; absolute paths and `file:` URIs refer to the Extension Host filesystem. Local and supported `data:` images load automatically near the viewport, while HTTPS images require an explicit `Load image` action and send no referrer. HTTP and other schemes remain blocked.
- Local and supported `data:` images are bounded by the configured attachment byte limit and by raster dimensions (16,384 px per side and 40 megapixels). Supported formats are PNG, JPEG, WebP, GIF, and static SVG. Local and `data:` SVG removes scripts, events, `foreignObject`, animation, style and external resources; visible safe output carries a warning when content was removed and otherwise fails closed. Remote SVG remains isolated as an `<img>` but is not content-inspected.
- Markdown images preserve aspect ratio, do not upscale, fit the message width, and use `min(480px, 60vh)` as their transcript height bound. An explicit Markdown title is a centered caption without surrounding card chrome; alt remains the accessible/failure description. Unlinked loaded images open the shared Lightbox, while linked images retain link behavior.
- Explicit Markdown file links and whitelisted inline-code references open through validated `openFile`; supported locations include line, column, line-range, and GitHub `#L` forms. HTTP(S) remains external.
- Incomplete Mermaid fences remain source text while streaming; only complete fences mount a diagram, and render failure shows the error plus original source.
- Fenced code blocks get a hover copy button (injected by `MarkdownHtml.svelte`, not part of sanitized HTML). It copies the block's raw code text through `copyText` and confirms in place briefly.
- Fence chrome: the outer `pre` clips and hosts the hover chrome; the inner `.code-scroll` scrolls. Prose-like languages (`txt`, `text`, `plaintext`, `md`, `markdown`, `tex`, `latex`) wrap by default; other and untagged fences scroll horizontally.
- Copy uses original protocol text in order, never rendered HTML, SVG, math markup, images, reasoning, tools, or notices.
