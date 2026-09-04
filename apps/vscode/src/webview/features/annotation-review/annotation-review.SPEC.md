# Response annotation review contract

Response annotation is a Webview-local prompt construction aid, not a Pi or conversation entity.

- A finalized assistant response with non-empty raw text exposes `Annotate` as a secondary action beside `Copy`. Ordinary conversation selection never opens annotation UI.
- Opening review freezes the same raw Markdown text used by `Copy`. Streaming updates, rendered Markdown, and later conversation projection changes do not alter that snapshot.
- Inside the review workspace, a non-whitespace source selection creates a character-range note draft. Saved notes may overlap and are displayed and exported in source order.
- One review draft exists per Session in each Webview presentation. It may survive Session switching within that Webview, but is neither transferred between presentations nor persisted through Webview destruction.
- Review exit and pending-note cancellation require confirmation when they would discard written work. Blocking Extension UI requests remain reachable during review.
- Inserting review produces only the fixed annotation envelope defined by `annotationPrompt.ts`. It has no natural-language preamble, locale inference, user template, complete-response copy, or user-input placeholder.
- The annotation envelope is placed before the existing Composer text with two separating newlines. Existing text and attachments are preserved exactly, focus moves to the end, and FrostPi never sends automatically.
- The Extension Host, shared bridge, Session model, and Pi RPC protocol do not represent annotations. Once inserted, the result is an ordinary Composer draft governed by the Composer contract.
