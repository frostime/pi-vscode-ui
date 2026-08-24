<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/vscodeBridge";

  let { session }: { session: SessionViewModel } = $props();
</script>

<section class="externalized-session" aria-labelledby="externalized-session-title">
  <span class="codicon codicon-layout" aria-hidden="true"></span>
  <h1 id="externalized-session-title">{session.title}</h1>
  <p>This Session is displayed in an editor tab.</p>
  <button type="button" onclick={() => postToHost({ type: "revealSessionPanel", sessionId: session.id })}>
    <span class="codicon codicon-go-to-file" aria-hidden="true"></span>
    Go to Session Tab
  </button>
</section>

<style>
  .externalized-session {
    align-self: center;
    justify-self: center;
    width: min(360px, calc(100% - 24px));
    margin: auto;
    padding: 20px 16px;
    text-align: center;
    border: 1px dashed var(--frost-border);
    border-radius: 7px;
    color: var(--frost-muted);
  }
  .externalized-session > :global(.codicon) { font-size: 20px; }
  h1 { margin: 8px 0 3px; color: var(--frost-text); font-size: 14px; }
  p { margin: 0 0 14px; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--frost-border);
    border-radius: 5px;
    background: var(--frost-surface-raised);
    color: var(--frost-text);
    cursor: pointer;
  }
  button:hover {
    background: var(--frost-hover);
    border-color: var(--frost-border-soft);
  }
  button:focus-visible {
    outline: 1px solid var(--frost-focus);
    outline-offset: 1px;
  }
</style>
