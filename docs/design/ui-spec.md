---
title: UI Design Specification
description: Cross-feature visual, layout, accessibility, theme, and user-owned interaction constraints.
scope:
  - /apps/vscode/src/webview/**
updated: 2026-07-28
---

# UI Design Specification

FrostPi uses a first-party VS Code visual language: compact, low-noise, keyboard-usable, and native to the active theme.

## Layout and theming

- The complete shell remains usable at 280px width and under VS Code light, dark, and high-contrast themes; committed capabilities may wrap or move, but must not require horizontal scrolling.
- Use semantic FrostPi variables mapped from VS Code variables. Respect editor zoom and `prefers-reduced-motion`; avoid fixed widths, large shadows, gradients, and pill-heavy chrome.
- The session shell may narrow or hide. Conversation space expands when hidden, while a keyboard-reachable restore control and required-background-input indication remain available.
- Conversation owns the scrollable transcript region. Composer remains bottom-anchored and may temporarily take the panel while preserving a clear restore path.
- The Question panel sits between conversation and Composer, has bounded independent scrolling, and must not hide or take ownership of conversation scrolling.

## User-owned interaction state

- Disclosure and conversation scroll position are user-owned. Live or persisted updates do not reopen collapsed content, resume paused following, or otherwise replace those choices.
- Initial/session-switch/new-turn navigation may follow output; after the user scrolls away, updates preserve the viewport and expose a jump-to-latest control.
- Collapsing a Question request or hiding the session shell does not cancel Host-owned work or pending input.

## Accessibility

- Every action is keyboard reachable with visible focus. Icon-only controls have accessible names; status is never conveyed by color alone.
- Transient status uses an `aria-live` region. Blocking requests remain in document order; images use filename-based alt text, and removal controls identify the affected image.
- Controls, text, focus, and status indicators remain perceivable in high-contrast themes and with reduced motion.
