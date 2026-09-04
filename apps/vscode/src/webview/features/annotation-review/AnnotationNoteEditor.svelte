<script lang="ts">
  import { onMount } from "svelte";

  let {
    mode,
    quote,
    value,
    anchorRect,
    onchange,
    onsave,
    oncancel,
  }: {
    mode: "create" | "edit";
    quote: string;
    value: string;
    anchorRect: () => DOMRect | null;
    onchange: (value: string) => void;
    onsave: () => void;
    oncancel: () => void;
  } = $props();

  let panel = $state<HTMLElement>();
  let textarea = $state<HTMLTextAreaElement>();
  let left = $state(12);
  let top = $state(12);

  export function focus(): void {
    textarea?.focus();
  }

  onMount(() => {
    const position = (): void => positionEditor();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    requestAnimationFrame(() => {
      positionEditor();
      textarea?.focus();
    });
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  });

  function positionEditor(): void {
    if (!panel || window.innerWidth <= 520) return;
    const anchor = anchorRect();
    if (!anchor) return;

    const margin = 10;
    const gap = 8;
    const panelRect = panel.getBoundingClientRect();
    const width = panelRect.width || Math.min(390, window.innerWidth - margin * 2);
    const height = panelRect.height || 280;

    left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
    const below = anchor.bottom + gap;
    top = below + height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchor.top - height - gap);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    onsave();
  }
</script>

<div
  class="note-editor"
  bind:this={panel}
  style:left={`${Math.round(left)}px`}
  style:top={`${Math.round(top)}px`}
  role="dialog"
  aria-label={mode === "create" ? "Add annotation" : "Edit annotation"}
>
  <header>
    <strong>{mode === "create" ? "Add annotation" : "Edit annotation"}</strong>
    <button class="icon-button" type="button" aria-label="Cancel annotation editing" title="Cancel" onclick={oncancel}>
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </header>

  <blockquote>{quote}</blockquote>

  <textarea
    bind:this={textarea}
    aria-label="Annotation text"
    placeholder="Write your note…"
    {value}
    oninput={(event) => onchange(event.currentTarget.value)}
    onkeydown={handleKeydown}
  ></textarea>

  <footer>
    <span>Ctrl / ⌘ + Enter</span>
    <button class="secondary-button" type="button" onclick={oncancel}>Cancel</button>
    <button class="primary-button" type="button" disabled={!value.trim()} onclick={onsave}>Save note</button>
  </footer>
</div>

<style>
  .note-editor {
    position: fixed;
    z-index: 80;
    width: min(390px, calc(100vw - 20px));
    max-height: calc(100vh - 20px);
    display: grid;
    grid-template-rows: auto auto minmax(105px, 1fr) auto;
    overflow: hidden;
    border: 1px solid var(--frost-border);
    border-radius: var(--radius-md);
    background: var(--frost-surface-raised);
    box-shadow: var(--frost-shadow);
  }

  header {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 9px 7px 12px;
    border-bottom: 1px solid var(--frost-border-soft);
  }

  header strong { font-size: 12px; }

  blockquote {
    max-height: 94px;
    margin: 10px 12px 0;
    padding: 7px 9px;
    overflow: auto;
    border-left: 2px solid var(--frost-link);
    background: color-mix(in srgb, var(--frost-link) 8%, transparent);
    color: var(--frost-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  textarea {
    min-width: 0;
    min-height: 105px;
    margin: 8px 12px;
    padding: 9px 10px;
    resize: vertical;
    border: 1px solid var(--frost-input-border);
    border-radius: var(--radius-sm);
    outline: none;
    background: var(--frost-input-bg);
    color: var(--frost-text);
    font: inherit;
    line-height: 1.45;
  }

  textarea:focus {
    border-color: var(--frost-focus);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--frost-focus) 22%, transparent);
  }

  textarea::placeholder { color: var(--frost-faint); }

  footer {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 0 12px 10px;
  }

  footer > span {
    margin-right: auto;
    color: var(--frost-faint);
    font-size: 9px;
    white-space: nowrap;
  }

  .secondary-button,
  .primary-button {
    min-height: 27px;
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 10.5px;
    cursor: pointer;
  }

  .secondary-button { background: var(--frost-secondary-bg); color: var(--frost-text); }
  .secondary-button:hover { background: var(--frost-secondary-hover); }
  .primary-button { background: var(--frost-accent); color: var(--frost-accent-text); }
  .primary-button:hover:not(:disabled) { background: var(--frost-accent-hover); }
  .primary-button:disabled { opacity: 0.42; cursor: default; }

  @media (max-width: 520px) {
    .note-editor {
      inset: auto 6px 6px !important;
      width: auto;
      max-height: min(72vh, 410px);
      border-radius: var(--radius-md);
    }

    blockquote { max-height: 72px; }
    textarea { min-height: 92px; }
    footer > span { display: none; }
  }
</style>
