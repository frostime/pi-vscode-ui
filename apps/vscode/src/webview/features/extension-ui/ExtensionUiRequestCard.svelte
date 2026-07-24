<script lang="ts">
  import type { PendingStandardExtensionUiView } from "$shared/model/extensionUiModel";
  import { postToHost } from "../../bridge/vscodeBridge";
  import IconButton from "../../primitives/IconButton.svelte";

  let { sessionId, request }: { sessionId: string; request: PendingStandardExtensionUiView } = $props();
  let value = $state("");
  let initializedRequestId = $state("");
  const canCancel = $derived(request.method !== "confirm");

  $effect(() => {
    if (initializedRequestId === request.id) return;
    initializedRequestId = request.id;
    value = request.prefill ?? "";
  });

  function cancel(): void {
    postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { cancelled: true } });
  }

  function submitValue(): void {
    postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { value } });
  }
</script>

<section class="extension-ui-card" aria-labelledby={`extension-ui-${request.id}`}>
  <div class="extension-ui-heading">
    <span class="codicon codicon-question"></span>
    <div class="extension-ui-copy">
      <strong id={`extension-ui-${request.id}`}>{request.title}</strong>
      {#if request.message}<p>{request.message}</p>{/if}
    </div>
    {#if canCancel}
      <IconButton icon="close" label="Cancel" onclick={cancel} />
    {/if}
  </div>

  {#if request.method === "select"}
    <div class="extension-select-options">
      {#each request.options ?? [] as option (option)}
        <button type="button" onclick={() => postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { value: option } })}>{option}</button>
      {/each}
    </div>
  {:else if request.method === "confirm"}
    <div class="extension-ui-actions">
      <button class="secondary" type="button" onclick={() => postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { confirmed: false } })}>No</button>
      <button class="primary" type="button" onclick={() => postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { confirmed: true } })}>Yes</button>
    </div>
  {:else if request.method === "editor"}
    <textarea class="extension-editor" bind:value rows="7" aria-label={request.title}></textarea>
    <div class="extension-ui-actions">
      <button class="primary" type="button" onclick={submitValue}>Submit</button>
    </div>
  {:else}
    <input
      class="extension-input"
      bind:value
      placeholder={request.placeholder ?? ""}
      aria-label={request.title}
      onkeydown={(event) => event.key === "Enter" && submitValue()}
    />
    <div class="extension-ui-actions">
      <button class="primary" type="button" onclick={submitValue}>Submit</button>
    </div>
  {/if}
</section>

<style>
.extension-ui-card {
  padding: 10px;
  background: var(--frost-surface);
  border: 1px solid color-mix(in srgb, var(--frost-focus) 42%, var(--frost-border));
  border-radius: 8px;
  box-shadow: 0 4px 15px rgba(0,0,0,.08);
}
.extension-ui-heading { display: flex; gap: 8px; align-items: flex-start; }
.extension-ui-heading > :global(.codicon) { margin-top: 2px; color: var(--frost-link); }
.extension-ui-copy { flex: 1; min-width: 0; }
.extension-ui-heading :global(strong) { font-size: 11px; }
.extension-ui-heading :global(p) { margin: 2px 0 0; color: var(--frost-muted); font-size: 10.5px; white-space: pre-wrap; }
.extension-ui-heading :global(.icon-button) { flex-shrink: 0; margin: -4px -4px 0 0; }
.extension-ui-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 9px; }
.extension-ui-actions :global(button) {
  padding: 5px 10px;
  border-radius: 5px;
  background: var(--frost-secondary-bg);
  cursor: pointer;
  font-size: 11px;
}
.extension-select-options :global(button) {
  padding: 5px 10px;
  border-radius: 5px;
  background: var(--frost-secondary-bg);
  cursor: pointer;
  font-size: 11px;
}
.extension-ui-actions :global(button:hover) { background: var(--frost-secondary-hover); }
.extension-select-options :global(button:hover) { background: var(--frost-secondary-hover); }
.extension-ui-actions :global(.primary) { background: var(--frost-accent); color: var(--frost-accent-text); }
.extension-ui-actions :global(.primary:hover) { background: var(--frost-accent-hover); }
.extension-select-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.extension-input {
  width: 100%;
  margin-top: 9px;
  padding: 7px 8px;
  background: var(--frost-input-bg);
  border: 1px solid var(--frost-input-border);
  border-radius: 5px;
  outline: 0;
}
.extension-editor {
  width: 100%;
  margin-top: 9px;
  padding: 7px 8px;
  background: var(--frost-input-bg);
  border: 1px solid var(--frost-input-border);
  border-radius: 5px;
  outline: 0;
}
.extension-input:focus { border-color: var(--frost-focus); }
.extension-editor:focus { border-color: var(--frost-focus); }
.extension-editor { resize: vertical; font-family: var(--font-mono); font-size: 11px; }
</style>
