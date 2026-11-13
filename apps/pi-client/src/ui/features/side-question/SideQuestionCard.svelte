<script lang="ts">
  import type { SideQuestionView } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/hostBridge";
  import MarkdownContent from "../conversation/MarkdownContent.svelte";

  /**
   * The `/btw` exchange. It sits beside the conversation, not in it: Pi never stores it,
   * so dismissing it or stopping the session removes it for good.
   */
  let { sessionId, question }: { sessionId: string; question: SideQuestionView } = $props();

  const usageLabel = $derived.by(() => {
    const parts: string[] = [];
    if (question.model) parts.push(question.model);
    if (question.usage) {
      const { input, output, cacheRead } = question.usage;
      parts.push(`${formatTokens(input + cacheRead)} in${cacheRead > 0 ? ` (${formatTokens(cacheRead)} cached)` : ""}`);
      parts.push(`${formatTokens(output)} out`);
    }
    return parts.join(" · ");
  });

  function dismiss(): void {
    postToHost({ type: "dismissSideQuestion", sessionId, questionId: question.id });
  }

  function copyAnswer(): void {
    if (question.answer) postToHost({ type: "copyText", text: question.answer });
  }

  function formatTokens(count: number): string {
    return count >= 1_000 ? `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1)}k` : String(count);
  }
</script>

<section class="side-question" aria-label="Side question">
  <header class="side-question-header">
    <span class="codicon codicon-comment" aria-hidden="true"></span>
    <span class="side-question-title">Side question</span>
    <span class="side-question-note">not added to the conversation</span>
    {#if question.status === "answered"}
      <button class="icon-button" type="button" aria-label="Copy answer" title="Copy answer" onclick={copyAnswer}>
        <span class="codicon codicon-copy" aria-hidden="true"></span>
      </button>
    {/if}
    <button class="icon-button" type="button" aria-label="Dismiss side question" title="Dismiss" onclick={dismiss}>
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </header>
  <div class="side-question-body">
    <p class="side-question-text">{question.question}</p>
    {#if question.status === "pending"}
      <div class="side-question-pending" role="status"><span class="thinking-pulse"></span> Answering…</div>
    {:else if question.status === "failed"}
      <div class="inline-error" role="alert">{question.error ?? "The side question failed."}</div>
    {:else}
      <div class="side-question-answer"><MarkdownContent content={question.answer ?? ""} /></div>
      {#if question.incomplete === "tool-call"}
        <div class="side-question-meta" role="note">The model also tried to use a tool, which a side question cannot do. This answer may be incomplete.</div>
      {:else if question.incomplete === "length"}
        <div class="side-question-meta" role="note">The model reached its output limit, so this answer is cut short.</div>
      {/if}
      {#if question.truncated}<div class="side-question-meta">The answer was cut at the length limit.</div>{/if}
      {#if usageLabel}<div class="side-question-meta">{usageLabel}</div>{/if}
    {/if}
  </div>
</section>

<style>
  .side-question {
    min-width: 0;
    max-width: var(--content-max-width);
    width: 100%;
    margin: 0 auto 6px;
    display: flex;
    flex-direction: column;
    max-height: min(46vh, 520px);
    border: 1px solid color-mix(in srgb, var(--frost-link) 38%, var(--frost-border));
    border-radius: 7px;
    background: var(--frost-surface-raised);
  }
  .side-question-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 2px 0 8px;
    border-bottom: 1px solid var(--frost-border-soft);
    color: var(--frost-muted);
    font-size: calc(var(--font-size-ui) - 2.5px);
  }
  .side-question-header > .codicon { color: var(--frost-link); }
  .side-question-title { color: var(--frost-text); font-weight: 600; }
  .side-question-note { min-width: 0; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-question-header .icon-button { width: 24px; height: 24px; flex: none; }
  .side-question-body { min-height: 0; overflow-y: auto; padding: 7px 10px 8px; }
  .side-question-text {
    margin: 0 0 7px;
    padding-left: 8px;
    border-left: 2px solid var(--frost-border);
    color: var(--frost-muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .side-question-pending { display: flex; align-items: center; gap: 7px; color: var(--frost-muted); }
  .side-question-answer { min-width: 0; }
  .side-question-meta { margin-top: 6px; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3px); }
</style>
