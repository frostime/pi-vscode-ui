<script lang="ts">
  import type { PendingStandardExtensionUiView } from "$shared/model/extensionUiModel";
  import { postToHost } from "../../bridge/hostBridge";
  import IconButton from "../../primitives/IconButton.svelte";

  let { sessionId, request }: { sessionId: string; request: PendingStandardExtensionUiView } = $props();
  let value = $state("");
  let initializedRequestId = $state("");
  const canCancel = $derived(request.method !== "confirm");
  const firstLine = $derived(request.title.split(/\r?\n/, 1)[0] ?? request.title);
  const question = $derived(request.questionSelect);
  const title = $derived(question?.question ?? firstLine);
  const detail = $derived(question?.details ?? request.title.slice(firstLine.length).replace(/^\r?\n/, ""));
  const options = $derived(request.options ?? []);
  const listedOptions = $derived(question ? options.slice(0, -1) : options);
  const custom = $derived(question ? options.at(-1) : undefined);
  const hasChoices = $derived(Boolean(question));

  $effect(() => {
    if (initializedRequestId === request.id) return;
    initializedRequestId = request.id;
    value = request.prefill ?? "";
  });

  function cancel(): void {
    postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { cancelled: true } });
  }

  function submitValue(value: string): void {
    postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { value } });
  }
</script>

<section class="extension-ui-card" class:has-choices={hasChoices} aria-labelledby={`extension-ui-${request.id}`}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users need to scroll the complete prompt) -->
  <div class="extension-ui-body" role="region" aria-label="Prompt details" tabindex="0">
    <header class="extension-ui-heading">
      <span class="codicon codicon-question" aria-hidden="true"></span>
      <div class="extension-ui-heading-copy">
        {#if question?.header}<span class="question-topic">{question.header}</span>{/if}
        <strong class="extension-ui-title" id={`extension-ui-${request.id}`}>{title}</strong>
      </div>
      {#if canCancel}
        <IconButton icon="close" label="Cancel" onclick={cancel} />
      {/if}
    </header>
    {#if detail}<p class="extension-ui-message">{detail}</p>{/if}
    {#if request.message}<p class="extension-ui-message">{request.message}</p>{/if}
    {#if request.method === "editor"}
      <textarea class="extension-editor" bind:value rows="7" aria-label={request.title}></textarea>
    {:else if request.method === "input"}
      <input
        class="extension-input"
        bind:value
        placeholder={request.placeholder ?? ""}
        aria-label={request.title}
        onkeydown={(event) => event.key === "Enter" && submitValue(value)}
      />
    {/if}
  </div>

  {#if request.method === "select"}
    <div class="extension-select-options" class:choice-list={hasChoices} role="group" aria-label="Choices">
      {#each listedOptions as option, index (index)}
        {@const choice = question?.choices[index]}
        <button type="button"
          aria-labelledby={choice ? `extension-ui-label-${request.id}-${index}` : undefined}
          aria-describedby={choice?.description ? `extension-ui-choice-${request.id}-${index}` : undefined}
          onclick={() => submitValue(option)}>
          {#if choice}
            <span class="choice-copy">
              <span class="choice-heading" id={`extension-ui-label-${request.id}-${index}`}>
                <strong>{choice.label}</strong>
                {#if choice.recommended}<span class="choice-recommendation">Recommended</span>{/if}
              </span>
              {#if choice.description}
                <span class="choice-description" id={`extension-ui-choice-${request.id}-${index}`}>{choice.description}</span>
              {/if}
            </span>
            <span class="choice-number" aria-hidden="true">{index + 1}</span>
          {:else}
            <span class="opaque-choice">{option}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if custom !== undefined}
      <div class="extension-select-options choice-list custom-answer">
        <button type="button" onclick={() => submitValue(custom)}>
          {question?.customLabel}
          <span class="codicon codicon-edit" aria-hidden="true"></span>
        </button>
      </div>
    {/if}
  {:else if request.method === "confirm"}
    <div class="extension-ui-actions">
      <button class="secondary" type="button" onclick={() => postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { confirmed: false } })}>No</button>
      <button class="primary" type="button" onclick={() => postToHost({ type: "respondExtensionUi", sessionId, requestId: request.id, response: { confirmed: true } })}>Yes</button>
    </div>
  {:else}
    <div class="extension-ui-actions">
      <button class="primary" type="button" onclick={() => submitValue(value)}>Submit</button>
    </div>
  {/if}
</section>

<style>
.extension-ui-card {
  max-height: min(40vh, 360px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  overflow: hidden;
  background: var(--frost-surface);
  border: 1px solid color-mix(in srgb, var(--frost-focus) 42%, var(--frost-border));
  border-radius: 8px;
  box-shadow: 0 4px 15px rgba(0,0,0,.08);
}
.extension-ui-heading { flex: 0 0 auto; display: flex; gap: 8px; align-items: flex-start; }
.extension-ui-heading > :global(.codicon) { margin-top: 2px; color: var(--frost-link); }
.extension-ui-heading-copy { flex: 1; min-width: 0; }
.extension-ui-title { display: block; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-detail); }
.extension-ui-heading :global(.icon-button) { flex-shrink: 0; margin: 0; }
.extension-ui-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.extension-ui-body:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: -1px; }
.extension-ui-message { margin: 6px 0 0; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 2.5px); white-space: pre-wrap; overflow-wrap: anywhere; }
.extension-ui-actions { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 6px; margin-top: 9px; }
.extension-ui-actions :global(button),
.extension-select-options :global(button) {
  padding: 4px 9px;
  border: 1px solid var(--frost-border);
  border-radius: 5px;
  background: var(--frost-secondary-bg);
  cursor: pointer;
  font-size: var(--font-size-detail);
}
.extension-select-options :global(button) {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}
.extension-ui-actions :global(button:hover),
.extension-select-options :global(button:hover) { background: var(--frost-secondary-hover); }
.extension-ui-actions :global(button:focus-visible),
.extension-select-options :global(button:focus-visible) { outline: 1px solid var(--frost-focus); outline-offset: -2px; }
.extension-ui-actions :global(.primary) { background: var(--frost-accent); color: var(--frost-accent-text); }
.extension-ui-actions :global(.primary:hover) { background: var(--frost-accent-hover); }
.extension-select-options { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 6px; max-height: min(17vh, 150px); overflow-y: auto; margin-top: 9px; }
.extension-ui-card.has-choices { max-height: min(52vh, 460px); }
.has-choices .extension-ui-body { flex: 0 1 auto; max-height: min(23vh, 155px); }
.has-choices .extension-ui-title { font-size: calc(var(--font-size-ui) + 2px); font-weight: 600; line-height: 1.35; }
.question-topic { display: block; margin-bottom: 3px; color: var(--frost-muted); font-size: var(--font-size-detail); overflow-wrap: anywhere; }
.extension-select-options.choice-list {
  display: grid;
  flex: 1 1 auto;
  min-height: 48px;
  max-height: min(38vh, 340px);
  align-content: start;
}
.choice-list > button {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  text-align: start;
  color: var(--frost-text);
  font-size: var(--font-size-ui);
  line-height: 1.4;
}
.choice-list.custom-answer { flex: 0 0 auto; min-height: 0; margin-top: 6px; }
.custom-answer > button { background: transparent; color: var(--frost-muted); }
.custom-answer > button:hover { background: var(--frost-secondary-hover); }
.choice-copy { min-width: 0; }
.choice-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; }
.choice-heading strong { font-weight: 600; white-space: pre-wrap; }
.choice-description { display: block; margin-top: 3px; color: var(--frost-muted); font-size: var(--font-size-compact); white-space: pre-wrap; }
.opaque-choice { white-space: pre-wrap; }
.choice-number { flex: none; color: var(--frost-muted); font-size: var(--font-size-detail); }
.choice-recommendation {
  padding: 0 5px;
  border: 1px solid color-mix(in srgb, var(--frost-link) 55%, var(--frost-border));
  border-radius: 4px;
  background: color-mix(in srgb, var(--frost-link) 12%, var(--frost-secondary-bg));
  color: var(--frost-link);
  font-size: var(--font-size-detail);
  font-weight: 600;
}
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
.extension-editor { resize: vertical; font-family: var(--font-mono); font-size: var(--font-size-detail); }
</style>
