<script lang="ts" module>
  import { get } from "svelte/store";

  import { absoluteFileReferencePath } from "$shared/files/fileReferences.js";
  import { FILE_LINK_SECTION, LINK_TARGET_KEY, WEB_LINK_SECTION } from "$shared/model/linkContextMenu.js";

  import { clientCapabilities as capabilitiesStore } from "../../../state/clientCapabilities.svelte";
  import { presentationStore } from "../../../state/sessionViewStore.svelte";

  /** Resting this long over a link reveals its target, so dragging across links stays quiet. */
  const LINK_PREVIEW_DELAY_MS = 1_000;
  const LINK_PREVIEW_GAP_PX = 6;
  const LINK_PREVIEW_EDGE_PX = 8;

  // One preview element and one pending timer serve every mounted message.
  let previewElement: HTMLDivElement | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewAnchor: Element | undefined;
  let previewOwner: HTMLElement | undefined;
  let mountedMessages = 0;

  function scheduleLinkPreview(anchor: Element, owner: HTMLElement): void {
    cancelLinkPreview();
    previewAnchor = anchor;
    previewOwner = owner;
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      showLinkPreview(anchor, owner);
    }, LINK_PREVIEW_DELAY_MS);
  }

  function cancelLinkPreview(): void {
    if (!previewAnchor && previewTimer === undefined) return;
    if (previewTimer !== undefined) {
      clearTimeout(previewTimer);
      previewTimer = undefined;
    }
    previewAnchor = undefined;
    previewOwner = undefined;
    if (previewElement) previewElement.dataset.visible = "false";
  }

  function showLinkPreview(anchor: Element, owner: HTMLElement): void {
    const label = linkPreviewLabel(anchor);
    if (!label) return;
    previewAnchor = anchor;
    previewOwner = owner;
    const element = previewElement ?? createPreviewElement();
    element.textContent = label;
    positionLinkPreview(element, anchor);
    element.dataset.visible = "true";
  }

  function createPreviewElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "link-preview";
    element.setAttribute("role", "tooltip");
    document.body.append(element);
    previewElement = element;
    return element;
  }

  function linkPreviewLabel(anchor: Element): string | undefined {
    const path = anchor.getAttribute("data-file-path");
    if (path) {
      if (!get(capabilitiesStore).openReferencedLocation) return undefined;
      const cwd = get(presentationStore).displayedSession?.cwd;
      return `${absoluteFileReferencePath(path, cwd)}${fileLocationSuffix(anchor)}`;
    }
    const href = anchor.getAttribute("href");
    return href && /^https?:\/\//i.test(href) ? href : undefined;
  }

  function fileLocationSuffix(anchor: Element): string {
    const line = anchor.getAttribute("data-file-line");
    if (!line) return "";
    const column = anchor.getAttribute("data-file-column");
    const endLine = anchor.getAttribute("data-file-end-line");
    return `:${line}${column ? `:${column}` : ""}${endLine ? `-${endLine}` : ""}`;
  }

  function positionLinkPreview(element: HTMLDivElement, anchor: Element): void {
    // A retained left offset constrains auto width, giving the next label a false height.
    element.style.left = "0px";
    const anchorRect = anchor.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - LINK_PREVIEW_EDGE_PX;
    const left = Math.min(Math.max(LINK_PREVIEW_EDGE_PX, anchorRect.left), Math.max(LINK_PREVIEW_EDGE_PX, maxLeft));
    const below = anchorRect.bottom + LINK_PREVIEW_GAP_PX;
    const above = anchorRect.top - height - LINK_PREVIEW_GAP_PX;
    const top = below + height > window.innerHeight - LINK_PREVIEW_EDGE_PX && above >= LINK_PREVIEW_EDGE_PX ? above : below;
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
  }

  // VS Code's webview frame reads the closest `data-vscode-context` when its
  // context menu opens, from a window listener that runs after this one. The
  // target is resolved now, so it follows the current Session cwd, and the
  // manifest's Copy Link Address / Copy Path entries copy what the preview shows.
  function handleContextMenu(event: MouseEvent): void {
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    const target = linkPreviewLabel(anchor);
    if (!target) {
      anchor.removeAttribute("data-vscode-context");
      return;
    }
    const section = anchor.hasAttribute("data-file-path") ? FILE_LINK_SECTION : WEB_LINK_SECTION;
    anchor.setAttribute("data-vscode-context", JSON.stringify({ webviewSection: section, [LINK_TARGET_KEY]: target }));
  }

  function anchorFromEvent(event: Event): Element | undefined {
    const target = event.target instanceof Element ? event.target : null;
    return target?.closest("a") ?? undefined;
  }
</script>

<script lang="ts">
  import { postToHost } from "../../../bridge/hostBridge";
  import { clientCapabilities } from "../../../state/clientCapabilities.svelte";
  import { ensureKatex, isKatexReady, renderMarkdownHtml } from "./renderMarkdown";
  import { mountMarkdownImages } from "./mountMarkdownImages";

  let { content }: { content: string } = $props();

  let container: HTMLDivElement | undefined = $state();

  // Bumps after KaTeX chunk loads so math placeholders re-render.
  let katexGeneration = $state(isKatexReady() ? 1 : 0);

  $effect(() => {
    if (isKatexReady()) return;
    let cancelled = false;
    void ensureKatex().then(() => {
      if (!cancelled) katexGeneration += 1;
    });
    return () => {
      cancelled = true;
    };
  });

  const html = $derived.by(() => {
    void katexGeneration;
    return renderMarkdownHtml(content);
  });

  $effect(() => {
    const root = container;
    if (!root) return;
    void html;
    for (const anchor of root.querySelectorAll("a[data-file-path]")) {
      if ($clientCapabilities.openReferencedLocation) {
        anchor.setAttribute("href", "#");
        anchor.removeAttribute("aria-disabled");
      } else {
        anchor.removeAttribute("href");
        anchor.setAttribute("aria-disabled", "true");
      }
    }
  });

  // ---- Code-block actions ----

  // Only explicit user choices are stored. Without an override, each language
  // keeps the wrapping default emitted by renderMarkdownHtml.
  const wrapOverrides = new Map<number, boolean>();

  // Re-run after every render: `{@html}` replacement drops enhancements.
  $effect(() => {
    const root = container;
    if (!root) return;
    void html; // dependency on the rendered markup
    const images = mountMarkdownImages(root);
    for (const [index, pre] of [...root.querySelectorAll("pre.hljs")].entries()) {
      pre.setAttribute("data-code-block-index", String(index));
      const wrapped = wrapOverrides.get(index) ?? pre.classList.contains("wrap");
      pre.classList.toggle("wrap", wrapped);
      pre.querySelector(":scope > .code-actions")?.remove();
      pre.prepend(createCodeBlockActions(wrapped));
    }
    return () => {
      images.destroy();
      if (previewOwner === root) cancelLinkPreview();
    };
  });

  function createCodeBlockActions(wrapped: boolean): HTMLDivElement {
    const actions = document.createElement("div");
    actions.className = "code-actions";
    actions.append(createWrapButton(wrapped), createCopyButton());
    return actions;
  }

  function createWrapButton(wrapped: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wrap-btn";
    button.innerHTML = '<span class="codicon codicon-word-wrap" aria-hidden="true"></span><span class="wrap-btn-label"></span>';
    updateWrapButton(button, wrapped);
    return button;
  }

  function updateWrapButton(button: HTMLButtonElement, wrapped: boolean): void {
    const actionLabel = wrapped ? "Disable line wrapping" : "Wrap long lines";
    const visibleLabel = button.querySelector(".wrap-btn-label");
    if (visibleLabel) visibleLabel.textContent = wrapped ? "Unwrap" : "Wrap";
    button.classList.toggle("active", wrapped);
    button.setAttribute("aria-pressed", String(wrapped));
    button.setAttribute("aria-label", actionLabel);
    button.title = actionLabel;
  }

  function createCopyButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.title = "Copy code";
    button.innerHTML = '<span class="codicon codicon-copy" aria-hidden="true"></span><span class="copy-btn-label">Copy</span>';
    return button;
  }

  // One pending revert timer per button; WeakMap so buttons dropped by a
  // re-render never accumulate entries.
  const COPIED_FEEDBACK_MS = 1_200;
  const copiedTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

  function copyCodeBlock(button: Element): void {
    const code = button.closest("pre")?.querySelector("code")?.textContent;
    if (!code) return;
    postToHost({ type: "copyText", text: code });
    const label = button.querySelector(".copy-btn-label");
    button.classList.add("copied");
    if (label) label.textContent = "Copied";
    const existing = copiedTimers.get(button);
    if (existing) clearTimeout(existing);
    copiedTimers.set(button, setTimeout(() => {
      button.classList.remove("copied");
      if (label) label.textContent = "Copy";
    }, COPIED_FEEDBACK_MS));
  }

  // ---- Click routing: code actions, file links, external links ----

  function handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;

    const wrapButton = target?.closest<HTMLButtonElement>("button.wrap-btn");
    if (wrapButton) {
      const pre = wrapButton.closest("pre");
      if (!pre) return;
      const wrapped = !pre.classList.contains("wrap");
      pre.classList.toggle("wrap", wrapped);
      updateWrapButton(wrapButton, wrapped);
      const index = Number(pre.getAttribute("data-code-block-index"));
      if (Number.isInteger(index) && index >= 0) wrapOverrides.set(index, wrapped);
      return;
    }

    const copyButton = target?.closest("button.copy-btn");
    if (copyButton) {
      copyCodeBlock(copyButton);
      return;
    }

    const anchor = target?.closest("a");
    const path = anchor?.getAttribute("data-file-path");
    if (path) {
      claimLinkClick(event);
      if (!$clientCapabilities.openReferencedLocation) return;
      const line = positiveInteger(anchor?.getAttribute("data-file-line"));
      const column = positiveInteger(anchor?.getAttribute("data-file-column"));
      const endLine = positiveInteger(anchor?.getAttribute("data-file-end-line"));
      postToHost({
        type: "openFile",
        path,
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
        ...(endLine === undefined ? {} : { endLine }),
      });
      return;
    }

    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    claimLinkClick(event);
    postToHost({ type: "openExternal", url: href });
  }

  // VS Code's webview frame routes every anchor click it sees on the window to
  // its own opener, ignoring defaultPrevented. For an external link that opener
  // asks "Open / Copy / Cancel" after FrostPi has already opened the page; for
  // a file link (href="#") it scrolls the frame to the top. Links FrostPi
  // handles therefore stop here, before the click bubbles to the window.
  function claimLinkClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function positiveInteger(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  // ---- Link target preview ----

  function handlePointerOver(event: PointerEvent): void {
    const anchor = anchorFromEvent(event);
    if (!anchor || anchor === previewAnchor) return;
    scheduleLinkPreview(anchor, event.currentTarget as HTMLElement);
  }

  function handlePointerOut(event: PointerEvent): void {
    const anchor = anchorFromEvent(event);
    if (!anchor || anchor !== previewAnchor) return;
    const related = event.relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    cancelLinkPreview();
  }

  function handleFocusIn(event: FocusEvent): void {
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    cancelLinkPreview();
    showLinkPreview(anchor, event.currentTarget as HTMLElement);
  }

  function linkActions(node: HTMLElement): { destroy(): void } {
    const hide = (): void => cancelLinkPreview();
    node.addEventListener("click", handleClick);
    node.addEventListener("contextmenu", handleContextMenu);
    node.addEventListener("pointerover", handlePointerOver);
    node.addEventListener("pointerout", handlePointerOut);
    node.addEventListener("focusin", handleFocusIn);
    node.addEventListener("focusout", hide);
    // One global listener pair serves the shared preview, regardless of transcript length.
    if (mountedMessages++ === 0) {
      window.addEventListener("scroll", cancelLinkPreview, true);
      window.addEventListener("resize", cancelLinkPreview);
    }
    return {
      destroy: () => {
        node.removeEventListener("click", handleClick);
        node.removeEventListener("contextmenu", handleContextMenu);
        node.removeEventListener("pointerover", handlePointerOver);
        node.removeEventListener("pointerout", handlePointerOut);
        node.removeEventListener("focusin", handleFocusIn);
        node.removeEventListener("focusout", hide);
        if (previewOwner === node) cancelLinkPreview();
        if (--mountedMessages === 0) {
          window.removeEventListener("scroll", cancelLinkPreview, true);
          window.removeEventListener("resize", cancelLinkPreview);
          previewElement?.remove();
          previewElement = undefined;
        }
      },
    };
  }
</script>

<div class="markdown-body" use:linkActions bind:this={container}>{@html html}</div>

<style>
  .markdown-body :global(a[data-file-path][aria-disabled="true"]) {
    color: inherit;
    text-decoration: none;
    cursor: text;
  }
</style>
