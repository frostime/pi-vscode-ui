---
title: UI Design Specification
description: Cross-feature visual, layout, accessibility, theme, and user-owned interaction constraints.
scope:
  - /apps/pi-client/src/ui/**
  - /apps/desktop/src/renderer/**
updated: 2026-10-02
---

# UI Design Specification

FrostPi uses a first-party VS Code visual language: compact, low-noise, keyboard-usable, and native to the active theme.

## Layout and theming

- In VS Code, the FrostPi sidebar is the sole Session-management surface. Editor Session Tabs are restricted conversation projections: they omit the Session list, New/Resume, rename, close/restart, configuration, and diagnostics controls.
- Externalizing the sidebar-selected Session keeps its sidebar header/navigation and replaces only conversation/Composer with a tab-reveal placeholder. Closing the tab restores conversation eligibility without affecting the Session process.
- The complete shell remains usable at 280px width and under VS Code light, dark, and high-contrast themes; committed capabilities may wrap or move, but must not require horizontal scrolling.
- Use semantic FrostPi variables mapped from VS Code variables. Respect editor zoom; avoid fixed widths, large shadows, gradients, and pill-heavy chrome.
- The session shell may narrow or hide. Conversation space expands when hidden, while a keyboard-reachable restore control and required-background-input indication remain available.
- Conversation owns the scrollable transcript region. Composer remains bottom-anchored and may temporarily take the panel while preserving a clear restore path.
- The metrics toolbar uses a chart icon plus Usage and a context-progress ring plus Context, with matched compact transparent buttons. Both triggers inherit the metrics row’s font family, size, weight and line height so they match extension-provided status labels; icons scale with that font. Do not repeat the percentage beside the ring or show session cost in the toolbar; precise percentage and cost remain in the Context popover. Unknown context usage is visually distinct from zero, and accessible labels/tooltips retain the numeric reading.
- Context and Provider Usage popovers share a 256px target width through `--metrics-popover-width`, a viewport-clamped width, 8px corners, 10px padding, the same raised surface/border/shadow and 11px base typography. Both use natural height capped at `min(480px, 70vh)` with internal overflow. Do not force equal heights or aspect ratios for short states. Usage adapts quota, balance and text results through normalized field semantics, not Provider-specific browser branches.
- Provider Usage sits immediately left of Context in the sidebar metrics row and opens a compact non-modal popover above it without unmounting conversation or Composer. The supported active provider queries automatically; successful snapshots survive reopening, keep their capture time, and update on explicit Refresh. Results scroll independently; reset availability has no redemption action. Outside pointer actions dismiss without stealing focus. Temporary mock results must be explicitly labelled.
- Response annotation temporarily replaces conversation and Composer only after an explicit action on finalized assistant text. Its source and notes scroll independently when side by side, while the stacked narrow layout uses one bounded workspace scroller. It remains usable at 280px and returns only an ordinary editable Composer draft; required Extension UI requests remain reachable during review.
- The Question panel and `select`, `confirm`, `input`, and `editor` extension-request UI sit between conversation and Composer, use bounded independent scrolling, and must not take ownership of conversation scrolling. A blocking request's action controls remain reachable while its content scrolls.
- Tool-call cards for shell/code tools (`bash`, `powershell`, `codemode`) replace the breathing status dot with a ticking elapsed readout while the call runs, and keep the final duration beside the status icon or diffstat once it ends; cancelled calls have no end time and show no duration. The final duration reads Pi's recorded per-call execution time when the session has one and falls back to the timestamp span otherwise, so it may settle slightly below the last tick, which counts hooks and dispatch time. The readout stays whole-second and coarse by design; it is a progress reassurance, not a stopwatch. Tools outside that list keep the quiet dot-and-icon presentation.

## User-owned interaction state

- Disclosure and conversation scroll position are user-owned. Live or persisted updates do not reopen collapsed content, resume paused following, or otherwise replace those choices.
- Initial/session-switch/new-turn navigation may follow output; after the user scrolls away, projected conversation-content updates preserve the viewport and expose a jump-to-latest control. Stats and other scalar session updates do not count as conversation updates.
- Collapsing a Question request or hiding the session shell does not cancel Host-owned work or pending input.
- An unfinished response annotation review is presentation-local and may survive displayed-Session switches within that Webview. It is not persisted or transferred between Sidebar and Session Tab presentations.

## Accessibility

- Every action is keyboard reachable with visible focus. Icon-only controls have accessible names; status is never conveyed by color alone.
- Transient status uses an `aria-live` region. Blocking requests remain in document order; attachment images use filename-based alt text, Markdown images preserve their authored alt text, and removal controls identify the affected image.
- Markdown HTTPS images require an explicit load action. Loaded transcript images preserve aspect ratio, stay within 92% of message width and a 640px maximum, and use a bounded viewport-relative height. They open a keyboard-accessible Lightbox unless wrapped by a Markdown link. Explicit titles, or concise alt text when no title exists, appear as centered captions without card chrome; load failures and SVG script-removal warnings remain inline and perceivable without color.
- Controls, text, focus, and status indicators remain perceivable in high-contrast themes.
- Motion is a visual supplement only: animations stay small-element, low-cost, and low-stimulation (fades, pulses, brief reveals); never introduce large-scale or spatial motion.
