---
title: UI Design Specification
description: Cross-feature layout, stylesheet ownership, accessibility and user-owned interaction state.
scope:
  - /apps/pi-client/src/ui/**
  - /apps/desktop/src/renderer/**
updated: 2026-10-24
---

# UI Design Specification

FrostPi's GUI keeps conversation and Composer central. Shared components use the established VS Code visual language rather than a separate Desktop design system. This document governs rules that span features; exact component dimensions and behavior belong in their code and nearest SPEC.

## Layout and theming

Shared UI must remain usable at 280px width and in VS Code light, dark and high-contrast themes. Necessary controls may wrap or move, but must not require horizontal scrolling. Desktop supplies the same variable/resource interface; its palette and product navigation are governed by `apps/desktop/SPEC.md`, not by an assumption that it inherits the user's current VS Code theme.

Use semantic FrostPi variables mapped from `--vscode-*`, existing font settings and Codicons. Respect editor zoom and keep chrome compact and low-noise. Do not rename theme vocabulary or duplicate shared styles to adapt a product. Workbench internals are not a supported styling API.

Conversation owns transcript scrolling; Composer stays bottom-anchored and may explicitly expand with a clear restore action. Interaction panels and popovers need their own bounded overflow so long content does not steal the conversation's scroll ownership or make required actions unreachable. The Usage and Context surfaces share metrics primitives and typography; their feature contract owns detailed layout and data presentation.

Navigation may narrow or hide, giving space back to the conversation. Keep a keyboard-reachable restore entry and background-input attention available. Hiding a surface changes presentation, not Session lifetime or pending work.

### VS Code presentations

The sidebar owns Session management. Session Tabs are pinned conversation projections, not another place to expose the whole collection or its New/Resume and administrative controls. When the selected Session is externalized, keep sidebar navigation and show its tab-reveal placeholder rather than a second editable conversation. Native placement and handoff rules are in `apps/pi-client/src/shared/bridge/webview-bridge.SPEC.md`.

Desktop's Project navigation is a product-owned outer shell around the same client. Do not apply the Session-Tab model to it or recreate ClientApp when hiding/resizing its sidebar.

## Stylesheet ownership

Component-private chrome belongs in that Svelte component's scoped style. Keep shared primitives and tokens, cross-tree shell/layout selectors, and body-mounted surfaces such as CodeMirror tooltips in `apps/pi-client/src/ui/styles/`. A feature-only rule should not be appended to a global sheet just because one already exists.

Both browser entries consume the common style entry. Product-specific palettes and outer-shell styling stay product-owned; adding a shared sheet must not require maintaining a parallel import list in each product. Generated Markdown and other content outside a component's scoped tree still need the appropriate shared styles; scope ownership is not a blanket ban on global selectors.

## User-owned interaction state

Disclosure, form input and conversation scroll position belong to the user. Live content and scalar status updates must not reopen collapsed sections, discard unfinished input or reset those choices. On initial display, Session switch or a new turn, the conversation may follow output; once the user scrolls away, preserve the viewport and offer a jump-to-latest action. A stats refresh is not a new conversation item.

An explicit annotation review may temporarily replace conversation/Composer, but remains presentation-local and produces an editable draft rather than another persisted conversation. Required extension input must remain reachable. Reviews may survive Session switches inside that document without being transferred between Sidebar and Session Tab presentations; the annotation and bridge SPECs own the details.

Collapsing or hiding an input panel does not cancel its Host-owned request. Keep the request bound to its Session and retain a visible route to required input. Do not auto-confirm it or answer through whichever Pi became foreground later.

## Accessibility

Actions must be keyboard reachable, with visible focus and accessible names for icon-only controls. Status must not rely only on color. Expose transient status through appropriate live text, and keep blocking requests in a meaningful document order with reachable actions.

Maintain contrast across supported themes and honor reduced-motion preferences. Activity feedback should use small, low-stimulation motion rather than animating large content regions; navigation transitions must also respect reduced motion.

Read the feature's code and local SPEC comments or adjacent feature SPEC for detailed interaction rules. A separate Markdown SPEC is not required when the constraint already lives beside the implementation. Do not duplicate those contracts or their CSS constants in this global guide.
