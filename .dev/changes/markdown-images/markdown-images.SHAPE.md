---
status: draft
---

# Markdown image rendering change shape

## Proposed change

Turn Markdown image syntax into a presentation-time resource instead of allowing `markdown-it` to emit an immediately active `<img src>`. The sanitized Markdown output carries an inert placeholder; a focused Webview component then applies source-specific policy, presentation state, SVG cleaning, and Lightbox behavior.

Local filesystem authority stays in the Extension Host. A resolver owned by the Webview-host boundary reads a bounded local file relative to the displayed Session, validates its actual format and dimensions, and returns it only to the originating Connection. HTTPS remains browser-owned and starts only after an explicit click. Conversation projection, Pi RPC, persisted entries, and attachment models remain unchanged.

This shape concentrates filesystem and validation complexity behind one Host resolver, UI lifecycle behind one image component, and request correlation behind one Webview client. It avoids both opening the Webview's filesystem roots and replacing the established Markdown renderer with a new AST renderer.

## Architecture choice

### Recommended: inert Markdown placeholder with focused Webview enhancement

`renderMarkdownHtml` remains a pure string-to-sanitized-HTML boundary. Its image rule preserves source, alt, title, and link context as escaped data but never places an unapproved source into `img.src`. `MarkdownHtml` mounts one `MarkdownImage` component into each resulting placeholder and unmounts it when the sanitized HTML is replaced.

The image component chooses among local/data/HTTPS behavior and owns only visible lifecycle. Host reads are routed through a correlated client. This matches the existing post-render code-block enhancement while keeping the larger image state machine declarative and scoped rather than adding more ad-hoc DOM mutation to `MarkdownHtml`.

### Rejected: broaden `localResourceRoots`

The accepted behavior permits any Extension Host-readable local file, including paths outside a workspace. Expressing that through Webview roots would require an excessively broad filesystem capability and awkward root changes when a Sidebar switches Sessions. It also would not solve network consent or SVG inspection.

### Rejected: render Markdown as a Svelte AST

A component-native Markdown tree would remove the post-render mount boundary, but it would require FrostPi to own paragraph nesting, emphasis, links, fences, KaTeX, Mermaid boundaries, and streaming reconciliation. That is much larger than the image requirement and creates a second Markdown rendering architecture.

### Rejected: proxy every HTTPS image through the Extension Host

A unified byte pipeline would permit inspection of remote SVG, but it would make FrostPi responsible for HTTP redirects, proxy behavior, timeouts, response limits, SSRF boundaries, and remote caching. The accepted product behavior only requires explicit user consent before browser image loading. Remote SVG therefore remains isolated by `<img>` semantics but is not content-inspected.

## Predicted production diff

```text
apps/vscode/src/webview/features/conversation/
├── markdown/
│   ├── renderMarkdown.ts                    modify  +35–55/-2–8      localized extension
│   │   Emits sanitized inert image placeholders and preserves alt/title/link semantics without activating sources.
│   ├── MarkdownHtml.svelte                  modify  +20–35/-2–8      additive lifecycle hook
│   │   Mounts and unmounts MarkdownImage roots after each sanitized HTML replacement; existing link/copy routing stays.
│   ├── mountMarkdownImages.ts               create  +45–70
│   │   Isolates the unusual sanitized-DOM-to-Svelte mount boundary and guarantees cleanup on streaming replacement.
│   ├── MarkdownImage.svelte                 create  +180–260
│   │   Owns source state, near-viewport local loading, HTTPS consent, inline failures, centered caption,
│   │   SVG warning, keyboard behavior, responsive sizing, and Lightbox intent; all feature-only CSS is scoped here.
│   ├── markdownImageClient.ts               create  +90–135
│   │   Owns request ids, Session-scoped keys, in-flight deduplication, bounded short-lived result caching,
│   │   late-result rejection, and the typed interface consumed by the component.
│   ├── sanitizeMarkdownSvg.ts               create  +100–155
│   │   Produces a static SVG subset, classifies whether unsafe content was removed, validates intrinsic bounds,
│   │   and fails closed without sharing Mermaid's more permissive foreignObject policy.
│   └── markdown.SPEC.md                     modify  +20–35/-1–3
│       Records source policies, local/remote SVG asymmetry, sizing, title/alt behavior, and presentation failures.
├── ImageLightbox.svelte                     create  +55–85
│   Extracts the actually shared modal image behavior with focusable close/Escape handling and responsive bounds.
└── ImageGallery.svelte                      modify  +8–18/-30–55     small extraction
    Reuses ImageLightbox while preserving attachment thumbnails and labels.

apps/vscode/src/webview/bridge/
└── applyHostMessage.ts                      modify  +3–8/-0          additive
    Delivers markdownImageResult to the request-correlation client; it does not write presentation state.

apps/vscode/src/extension/webview-host/
├── markdown-images/
│   ├── MarkdownImageResolver.ts             create  +150–220
│   │   Owns relative/plain/file URI resolution, ordinary-file reads, byte limits, content-type detection,
│   │   structured failure mapping, and sensitive-data-free diagnostics.
│   └── inspectRasterImage.ts                create  +110–170
│       Pure bounded header inspection for PNG, JPEG, WebP, and GIF type/intrinsic dimensions/pixel limits.
├── WebviewActionDispatcher.ts               modify  +20–35/-0–5      additive authorized action
│   Authorizes against the displayed Session, supplies cwd and configured limit, and posts an inline result
│   instead of allowing ordinary image failures to become global Toasts.
└── createWebviewHtml.ts                     modify  +1–4/-1–2        localized policy change
    Allows explicitly activated HTTPS `<img>` sources while keeping connect-src and other schemes closed.

apps/vscode/src/shared/bridge/
├── webviewToHost.ts                         modify  +8–15/-0         additive bounded request schema
├── hostToWebview.ts                         modify  +12–22/-0        additive structured result union
├── bridgeVersion.ts                         modify  one value        compatibility boundary
└── webview-bridge.SPEC.md                   modify  +10–18/-0
    Records Connection authorization, response correlation, non-persistence, limits, and sensitive logging rules.

apps/vscode/test/unit/
├── renderMarkdown.test.ts                   modify  +35–55/-0
│   Covers inert output, escaped source/alt/title, links, rejected schemes, and unchanged raw-HTML sanitization.
├── sanitizeMarkdownSvg.test.ts              create  +90–140
│   Covers scripts/events/foreignObject/style URLs, fragment references, warnings, invalid roots, and dimensions.
├── markdownImageClient.test.ts              create  +70–110
│   Covers correlation, Session isolation, in-flight deduplication, bounded cache, cancellation, and late results.
├── MarkdownImageResolver.test.ts            create  +110–170
│   Covers relative/absolute/file paths, remote-host filesystem semantics represented through fixtures,
│   ordinary-file and size failures, content sniffing, and structured errors without sensitive text.
├── inspectRasterImage.test.ts               create  +90–140
│   Covers each supported raster header, malformed/truncated input, overflow, edge dimensions, and pixel bombs.
├── WebviewActionDispatcher.test.ts          modify  +35–60/-0
│   Covers displayed-Session authorization, cwd/limit routing, same-Connection responses, and no Toast on failures.
├── webviewBridgeSchema.test.ts              modify  +25–45/-0
│   Covers request bounds, complete discriminated unions, and protocol result examples.
└── Markdown image component tests           create/modify grouped  +80–140
    jsdom/Svelte behavior coverage for consent, loading/error/warning states, caption semantics, cleanup,
    link precedence, keyboard Lightbox, Blob revocation, and responsive class/attribute contracts.

.dev/docs/
├── architecture/overview.md                 modify  +2–5/-0
│   Clarifies that local Markdown images are bounded presentation resources mediated by the Extension Host.
└── design/ui-spec.md                        modify  +5–10/-1–3
    Records Markdown alt/title semantics, explicit HTTPS consent, inline status accessibility, and image bounds.
```

Expected total production/test change is approximately `+1,050–1,550/-40–90` lines. Most existing logic is preserved. The only reorganization is extracting the existing attachment Lightbox so Markdown and attachment images do not drift into two modal implementations.

No changes are predicted under `packages/pi-rpc`, `extension/conversation`, conversation ViewModels, Session persistence, Composer attachment schemas, or global Webview style sheets.

## Ownership and dependency shifts

```text
renderMarkdown.ts
  └─ emits inert semantic placeholder
          │ sanitized HTML
          ▼
mountMarkdownImages ──mounts──► MarkdownImage.svelte
                                      ├─ data/SVG policy → sanitizeMarkdownSvg
                                      ├─ HTTPS click → browser <img>
                                      ├─ preview → ImageLightbox
                                      └─ local request → markdownImageClient
                                                               │ validated bridge
                                                               ▼
                                                    WebviewActionDispatcher
                                                               │ cwd + byte limit
                                                               ▼
                                                    MarkdownImageResolver
                                                               │ pure raster facts
                                                               ▼
                                                    inspectRasterImage
```

- The Markdown renderer knows image syntax but not filesystem, network, cache, or component state.
- `MarkdownImage` knows presentation states but never imports VS Code or reads local files.
- `markdownImageClient` knows correlation and temporary deduplication but not DOM or file policy.
- `WebviewActionDispatcher` authorizes the Session target but delegates path and format decisions.
- `MarkdownImageResolver` knows host filesystem policy but not conversation ordering or Svelte UI.
- SVG sanitization stays in the browser beside DOMPurify; raw SVG is never inserted into rendered Markdown HTML.
- The shared bridge describes only serializable bounded messages and owns no behavior.

## Coordination and state rules

1. The source is inert until `MarkdownImage` classifies it. Unknown, HTTP, malformed, and oversized data sources never become an active `img.src`.
2. Local requests include a request id and expected Session id. Host authority remains the originating Connection's current displayed Session; a mismatch is rejected.
3. Ordinary resolver failures are returned as result values. Unexpected failures are normalized to `readFailed`; only non-sensitive reason/size/type metadata may be logged.
4. Component destruction unregisters its waiter. A Host response for an unknown request has no effect.
5. Concurrent requests for the same Session/source share one in-flight result. Successful local results may use a small byte-bounded, short-lived Webview cache to survive Markdown streaming replacement; no failure or Blob URL is persisted.
6. Each mounted component owns and revokes its own Blob URL. Cache eviction cannot invalidate a currently displayed image.
7. Near-viewport observation may start local reads automatically; it never starts HTTPS access. The no-network-before-click invariant is independent of browser-native `loading="lazy"`.
8. Loading an image changes only DOM presentation. It does not increment conversation content revision or instruct conversation scrolling to follow. Existing browser scroll anchoring and ConversationView resize behavior remain authoritative.

## Likely future changes and containment

- **Add another local image format:** Host type/dimension inspector, resolver contract tests, and accepted MIME union; UI remains unchanged.
- **Change byte or pixel limits:** resolver inputs/policy and tests; Markdown parsing and bridge shape remain stable.
- **Add a remote-image preference:** HTTPS branch and configuration projection; local resolver remains unchanged.
- **Proxy or inspect remote SVG later:** add a separately designed Host network loader behind the existing component intent. It must not be smuggled into the local resolver without defining redirects, proxy, SSRF, and response limits.
- **Refresh a changed local file:** evolve the temporary cache/reload UI; no file watcher or persistence hook is pre-created now.
- **Add download/open-source actions:** component-level actions plus separately authorized Host operations; not anticipated through generic callback slots.
- **Change caption or warning treatment:** MarkdownImage scoped markup/styles and UI tests only.

## Debug story

A failure can be localized in order:

1. sanitized HTML contains (or does not contain) the inert placeholder;
2. mounted image state reports source classification and request id, without exposing source in logs;
3. Bridge schema/Connection authorization accepts or rejects the request;
4. resolver returns a stable failure reason or validated MIME/dimensions;
5. SVG sanitizer reports blocked/clean/cleaned;
6. browser image decode or HTTPS load succeeds/fails.

No fallback silently changes a local path into a network URL, retries another Session cwd, or bypasses validation.

## Deliberate cuts

The first implementation does not add a general Webview resource service, persistent/disk cache, file watcher, refresh button, image download, HTTP support, domain allowlist UI, remote proxy, retry policy, remote SVG inspection, raw SVG insertion, script opt-in, EXIF processing, image conversion, Pi attachment conversion, or changes to message copy text.

The prototype is a review artifact only and will not be imported into production code.

## Shape review point

The principal structural choice for review is the sanitized-placeholder-to-mounted-Svelte boundary. It adds one explicit adapter because Svelte components cannot be emitted by `{@html}`; replacing the complete Markdown renderer to avoid that adapter would be disproportionate. If this boundary is accepted, local function signatures and exact cache constants can remain implementation decisions.
