<script lang="ts">
  import type { PendingQuestionUiView } from "$shared/model/extensionUiModel";

  import IconButton from "../../primitives/IconButton.svelte";
  import QuestionForm from "./QuestionForm.svelte";

  let { sessionId, requests }: { sessionId: string; requests: PendingQuestionUiView[] } = $props();
  let collapsed = $state(false);
  let activeRequestId = $state("");

  const activeRequest = $derived(requests.find((request) => request.id === activeRequestId) ?? requests[0]);

  $effect(() => {
    if (!requests.length) {
      activeRequestId = "";
      return;
    }
    if (!requests.some((request) => request.id === activeRequestId)) activeRequestId = requests[0]!.id;
  });
</script>

{#if requests.length}
  <section class="question-tool-panel" class:collapsed aria-label="Questions from Pi">
    <header class="question-tool-heading">
      <span class="codicon codicon-question" aria-hidden="true"></span>
      <button class="question-tool-title" type="button" onclick={() => collapsed = !collapsed}>
        <strong>{activeRequest?.title ?? "Questions"}</strong>
        <small>{requests.length === 1 ? "Pi needs your input" : `${requests.length} requests need your input`}</small>
      </button>
      {#if requests.length > 1 && !collapsed}
        <div class="request-switcher" aria-label="Pending question requests">
          {#each requests as request, index (request.id)}
            <button
              type="button"
              class:active={request.id === activeRequest?.id}
              aria-label={`Open question request ${index + 1}`}
              onclick={() => activeRequestId = request.id}
            >{index + 1}</button>
          {/each}
        </div>
      {/if}
      <IconButton
        icon={collapsed ? "chevron-up" : "chevron-down"}
        label={collapsed ? "Show questions" : "Collapse questions"}
        onclick={() => collapsed = !collapsed}
      />
    </header>

    <div class="question-tool-body" class:hidden={collapsed}>
      {#each requests as request (request.id)}
        <QuestionForm {sessionId} {request} hidden={request.id !== activeRequest?.id} />
      {/each}
    </div>
  </section>
{/if}

<style>
  .question-tool-panel {
    width: 100%;
    max-width: var(--content-max-width);
    min-height: 0;
    margin: 0 auto 6px;
    overflow: hidden;
    background: var(--frost-surface);
    border: 1px solid var(--frost-border);
    border-radius: 6px;
  }
  .question-tool-panel.collapsed { flex: 0 0 auto; }
  .question-tool-body.hidden { display: none; }
  .question-tool-heading {
    min-height: 34px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 5px 4px 8px;
    border-bottom: 1px solid var(--frost-border-soft);
  }
  .collapsed .question-tool-heading { border-bottom: 0; }
  .question-tool-heading > :global(.codicon-question) { color: var(--frost-link); }
  .question-tool-title {
    appearance: none;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
    padding: 0;
    overflow: hidden;
    text-align: left;
    background: transparent;
    cursor: pointer;
  }
  .question-tool-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .question-tool-title small { flex: 0 0 auto; color: var(--frost-muted); font-size: 9.5px; }
  .request-switcher { display: flex; gap: 3px; }
  .request-switcher button { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 4px; color: var(--frost-muted); background: var(--frost-secondary-bg); font-size: 9.5px; cursor: pointer; }
  .request-switcher button.active { color: var(--frost-accent-text); background: var(--frost-accent); }
  @media (max-width: 360px) {
    .question-tool-title small { display: none; }
  }
</style>
