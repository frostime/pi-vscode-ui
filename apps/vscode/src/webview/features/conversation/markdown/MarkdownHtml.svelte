<script lang="ts">
  import { postToHost } from "../../../bridge/vscodeBridge";
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
    return () => images.destroy();
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
      event.preventDefault();
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
    event.preventDefault();
    postToHost({ type: "openExternal", url: href });
  }

  function positiveInteger(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  function linkActions(node: HTMLElement): { destroy(): void } {
    node.addEventListener("click", handleClick);
    return { destroy: () => node.removeEventListener("click", handleClick) };
  }
</script>

<div class="markdown-body" use:linkActions bind:this={container}>{@html html}</div>
