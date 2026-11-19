<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { SubagentTarget, SubagentTranscriptView } from "$shared/model/extensionUiModel";
  import { requestSubagentTranscript } from "./subagentTranscriptClient";

  let { sessionId, target, name, onclose }: {
    sessionId: string;
    target: SubagentTarget;
    name: string;
    onclose(): void;
  } = $props();
  let transcript = $state<SubagentTranscriptView>();
  let body = $state<HTMLElement>();
  let cancel: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;

  function refresh(): void {
    cancel?.();
    if (timer) clearTimeout(timer);
    cancel = requestSubagentTranscript(sessionId, target, result => {
      const follow = !body || body.scrollHeight - body.scrollTop - body.clientHeight < 24;
      transcript = result;
      if (follow) void tick().then(() => {
        if (mounted && body) body.scrollTop = body.scrollHeight;
      });
      if (!("error" in result) && !result.finished) timer = setTimeout(refresh, 1_500);
    });
  }

  onMount(() => {
    mounted = true;
    body?.focus({ preventScroll: true });
    refresh();
    return () => {
      mounted = false;
      cancel?.();
      if (timer) clearTimeout(timer);
    };
  });

  function roleLabel(role: string, kind: string, name?: string): string {
    if (kind === "toolCall") return name ?? "Tool call";
    if (kind === "toolResult") return name ? `${name} output` : "Tool output";
    if (role === "user") return "Instruction";
    if (role === "toolResult") return "Tool output";
    return role === "assistant" ? "Assistant" : "Activity";
  }
</script>

<section class="transcript" aria-label={`Transcript for ${name}`}>
  <header>
    <strong title={name}>{name}</strong>
    {#if transcript && !("error" in transcript)}<span class="state">{transcript.state}</span>{/if}
    <button type="button" aria-label="Close worker transcript" title="Close worker transcript" onclick={onclose}>
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable transcript needs a keyboard focus target.) -->
  <div class="transcript-body" bind:this={body} tabindex="0" role="region" aria-label="Recent worker activity">
    {#if !transcript}
      <p>Loading transcript…</p>
    {:else if "error" in transcript}
      <p>{transcript.error}</p>
      <button class="retry" type="button" onclick={refresh}>Refresh</button>
    {:else}
      {#if transcript.truncated}<p>Pi shortened this transcript.</p>{/if}
      {#each transcript.messages as message, index (index)}
        <div class="event">
          <strong>{roleLabel(message.role, message.kind, message.name)}</strong>
          <div class:tool={message.kind === "toolCall" || message.kind === "toolResult"}>{message.text}</div>
        </div>
      {/each}
      {#if transcript.finalOutput}
        <div class="event"><strong>Result</strong><div>{transcript.finalOutput}</div></div>
      {:else if transcript.messages.length === 0}
        <p>{transcript.finished ? "Pi recorded no messages for this worker." : "Waiting for worker activity…"}</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .transcript { display: flex; flex-direction: column; flex: 1; border: 1px solid var(--frost-border); border-radius: 7px; min-width: 0; min-height: 0; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 8px; background: var(--frost-surface); }
  header strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state { color: var(--frost-muted); text-transform: capitalize; }
  button { border: 0; background: transparent; color: inherit; border-radius: 4px; cursor: pointer; }
  header button { display: grid; place-items: center; width: 24px; height: 24px; flex: none; }
  button:hover { background: var(--frost-hover); }
  .transcript-body { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; padding: 8px 10px; overflow-wrap: anywhere; }
  .transcript-body:focus-visible, button:focus-visible { outline: 1px solid var(--frost-link); outline-offset: -1px; }
  p { margin: 0; color: var(--frost-muted); }
  .event + .event { margin-top: 10px; }
  .event strong { color: var(--frost-muted); }
  .event div { margin-top: 2px; white-space: pre-wrap; }
  .tool { font-family: var(--font-mono); }
  .retry { margin-top: 6px; padding: 3px 6px; color: var(--frost-link); }
</style>
