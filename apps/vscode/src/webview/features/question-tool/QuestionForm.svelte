<script lang="ts">
  import type { PendingQuestionUiView } from "$shared/model/extensionUiModel";

  import { postToHost } from "../../bridge/vscodeBridge";
  import {
    createQuestionDraft,
    questionDraftComplete,
    questionSubmission,
    saveCustomQuestionAnswer,
    selectQuestionOption,
  } from "./questionDraft";

  let { sessionId, request, hidden = false }: { sessionId: string; request: PendingQuestionUiView; hidden?: boolean } = $props();
  let currentTab = $state(0);
  let draft = $state(createQuestionDraft());
  let customAnswers = $state<Record<string, string>>({});

  const reviewTab = $derived(request.questions.length);
  const complete = $derived(questionDraftComplete(draft, request.questions));
  const question = $derived(request.questions[currentTab]);

  function cancel(): void {
    postToHost({ type: "respondQuestion", sessionId, requestId: request.id, response: { cancelled: true } });
  }

  function submit(): void {
    if (!complete) return;
    postToHost({
      type: "respondQuestion",
      sessionId,
      requestId: request.id,
      response: questionSubmission(draft, request.questions),
    });
  }

  function updateCustom(questionId: string, value: string): void {
    customAnswers = { ...customAnswers, [questionId]: value };
  }

  function saveCustom(): void {
    if (!question) return;
    draft = saveCustomQuestionAnswer(draft, question, customAnswers[question.id] ?? "");
  }
</script>

<div class="question-form" class:hidden aria-hidden={hidden}>
  <div class="question-tabs" role="tablist" aria-label="Questions">
    {#each request.questions as item, index (item.id)}
      <button
        type="button"
        role="tab"
        aria-selected={currentTab === index}
        class:active={currentTab === index}
        class:answered={draft.answers[item.id] !== undefined}
        onclick={() => currentTab = index}
      >
        <span aria-hidden="true">{draft.answers[item.id] ? "●" : "○"}</span>
        {item.label}
      </button>
    {/each}
    <button
      type="button"
      role="tab"
      aria-selected={currentTab === reviewTab}
      class:active={currentTab === reviewTab}
      class:answered={complete}
      onclick={() => currentTab = reviewTab}
    >Review</button>
  </div>

  <div class="question-scroll">
    {#if question}
      <section class="question-page" aria-labelledby={`question-${request.id}-${question.id}`}>
        <h3 id={`question-${request.id}-${question.id}`}>{question.prompt}</h3>
        {#if question.options.length}
          <div class="question-options">
            {#each question.options as option, index (`${question.id}-${index}`)}
              <button
                type="button"
                class:selected={draft.answers[question.id]?.wasCustom === false && draft.answers[question.id]?.index === index + 1}
                onclick={() => draft = selectQuestionOption(draft, question, option, index)}
              >
                <span class="option-mark" aria-hidden="true">
                  {draft.answers[question.id]?.wasCustom === false && draft.answers[question.id]?.index === index + 1 ? "●" : "○"}
                </span>
                <span><strong>{option.label}</strong>{#if option.description}<small>{option.description}</small>{/if}</span>
              </button>
            {/each}
          </div>
        {/if}

        <div class="custom-answer" class:selected={draft.answers[question.id]?.wasCustom === true}>
          <label for={`custom-${request.id}-${question.id}`}>Write an answer</label>
          <textarea
            id={`custom-${request.id}-${question.id}`}
            rows="4"
            value={customAnswers[question.id] ?? (draft.answers[question.id]?.wasCustom ? draft.answers[question.id]?.value : "")}
            oninput={(event) => updateCustom(question.id, event.currentTarget.value)}
          ></textarea>
          <button class="secondary" type="button" disabled={!(customAnswers[question.id] ?? "").trim()} onclick={saveCustom}>
            Use written answer
          </button>
        </div>
      </section>
    {:else}
      <section class="question-review">
        <h3>Review answers</h3>
        <div class="answer-review">
          {#each request.questions as item (item.id)}
            <button type="button" onclick={() => currentTab = request.questions.indexOf(item)}>
              <strong>{item.label}</strong>
              <span class:missing={!draft.answers[item.id]}>{draft.answers[item.id]?.label ?? "Answer required"}</span>
            </button>
          {/each}
        </div>
        <label class="overall-note" for={`note-${request.id}`}>
          <span>Overall note <small>optional</small></span>
          <textarea id={`note-${request.id}`} rows="4" bind:value={draft.extraNote}></textarea>
        </label>
      </section>
    {/if}
  </div>

  <div class="question-actions">
    <button class="secondary" type="button" onclick={cancel}>Cancel</button>
    <div class="question-navigation">
      <button class="secondary" type="button" disabled={currentTab === 0} onclick={() => currentTab = Math.max(0, currentTab - 1)}>Back</button>
      {#if currentTab < reviewTab}
        <button class="primary" type="button" onclick={() => currentTab = Math.min(reviewTab, currentTab + 1)}>Next</button>
      {:else}
        <button class="primary" type="button" disabled={!complete} onclick={submit}>Submit</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .question-form { min-height: 0; display: flex; flex-direction: column; }
  .question-form.hidden { display: none; }
  .question-tabs { display: flex; gap: 3px; overflow-x: auto; padding: 7px 8px 6px; border-bottom: 1px solid var(--frost-border-soft); }
  .question-tabs button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border-radius: 5px; color: var(--frost-muted); font-size: 10.5px; cursor: pointer; }
  .question-tabs button.active { color: var(--frost-text); background: var(--frost-active); }
  .question-tabs button.answered:not(.active) { color: var(--frost-success); }
  .question-scroll { min-height: 0; max-height: min(46vh, 430px); overflow: auto; padding: 11px; }
  .question-page h3, .question-review h3 { margin: 0 0 10px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
  .question-options { display: grid; gap: 5px; }
  .question-options > button { display: flex; align-items: flex-start; gap: 7px; width: 100%; padding: 7px 8px; text-align: left; border: 1px solid var(--frost-border-soft); border-radius: 6px; background: var(--frost-secondary-bg); cursor: pointer; }
  .question-options > button:hover { background: var(--frost-secondary-hover); }
  .question-options > button.selected { border-color: var(--frost-focus); background: color-mix(in srgb, var(--frost-active) 65%, var(--frost-secondary-bg)); }
  .question-options strong { display: block; font-size: 11px; font-weight: 600; }
  .question-options small { display: block; margin-top: 2px; color: var(--frost-muted); font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
  .option-mark { color: var(--frost-link); }
  .custom-answer { display: grid; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--frost-border-soft); }
  .custom-answer.selected label { color: var(--frost-success); }
  .custom-answer label, .overall-note > span { font-size: 10.5px; font-weight: 600; }
  textarea { width: 100%; padding: 7px 8px; resize: vertical; color: var(--frost-text); background: var(--frost-input-bg); border: 1px solid var(--frost-input-border); border-radius: 5px; outline: 0; font: inherit; line-height: 1.45; }
  textarea:focus { border-color: var(--frost-focus); }
  .answer-review { display: grid; gap: 5px; }
  .answer-review button { display: grid; grid-template-columns: minmax(70px, auto) minmax(0, 1fr); gap: 8px; width: 100%; padding: 6px 8px; text-align: left; border-radius: 5px; background: var(--frost-secondary-bg); cursor: pointer; }
  .answer-review strong { font-size: 10.5px; }
  .answer-review span { overflow-wrap: anywhere; color: var(--frost-muted); font-size: 10.5px; }
  .answer-review span.missing { color: var(--frost-warning); }
  .overall-note { display: grid; gap: 5px; margin-top: 12px; }
  .overall-note small { color: var(--frost-muted); font-weight: 400; }
  .question-actions { display: flex; justify-content: space-between; gap: 8px; padding: 8px; border-top: 1px solid var(--frost-border-soft); }
  .question-navigation { display: flex; gap: 6px; }
  .question-actions button, .custom-answer button { padding: 5px 10px; border-radius: 5px; font-size: 11px; cursor: pointer; }
  button.secondary { background: var(--frost-secondary-bg); }
  button.primary { background: var(--frost-accent); color: var(--frost-accent-text); }
  button:hover:not(:disabled) { filter: brightness(1.06); }
  button:disabled { opacity: .4; cursor: default; }
  @media (max-width: 360px) {
    .question-scroll { max-height: min(42vh, 360px); padding: 9px; }
    .answer-review button { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
