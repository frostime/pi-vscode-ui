<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import SessionInteraction from "./SessionInteraction.svelte";

  let { session }: { session: SessionViewModel } = $props();
</script>

<div class="app-shell panel-shell">
  {#if session.status === "failed"}
    <section class="panel-failure" role="status">
      <span class="codicon codicon-error" aria-hidden="true"></span>
      <h1>Session unavailable</h1>
      <p>{session.error ?? "This Session's Pi process stopped. Use the FrostPi sidebar to manage or restart it."}</p>
    </section>
  {:else}
    <SessionInteraction {session} surfaceKind="panel" />
  {/if}
</div>

<style>
  .panel-failure {
    align-self: center;
    width: min(520px, calc(100% - 24px));
    margin: auto;
    padding: 18px;
    border: 1px solid var(--frost-border);
    border-radius: 6px;
    background: var(--frost-surface-raised);
  }
  .panel-failure :global(.codicon) { color: var(--frost-error); }
  .panel-failure h1 { margin: 8px 0 4px; font-size: 14px; }
  .panel-failure p { margin: 0; color: var(--frost-muted); line-height: 1.45; }
</style>
