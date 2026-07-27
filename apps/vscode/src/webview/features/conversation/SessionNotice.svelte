<script lang="ts">
  import type { SessionNoticeView } from "$shared/model/conversationModel";
  import MarkdownContent from "./MarkdownContent.svelte";

  let { notice }: { notice: SessionNoticeView } = $props();
</script>

<div class={`session-notice session-notice-${notice.level}`}>
  <span class={`codicon codicon-${notice.level}`}></span>
  <MarkdownContent content={notice.text} />
</div>

<style>
.session-notice {
  margin: 3px 0 10px;
  display: grid;
  grid-template-columns: 15px minmax(0,1fr);
  gap: 7px;
  align-items: start;
  color: var(--frost-muted);
  font-size: 10.5px;
}
.session-notice > :global(.codicon) { padding-top: 3px; color: var(--frost-link); }
.session-notice-warning { color: var(--frost-warning); }
.session-notice-warning > :global(.codicon) { color: var(--frost-warning); }
.session-notice-error { color: var(--frost-error); }
.session-notice-error > :global(.codicon) { color: var(--frost-error); }
.session-notice :global(.markdown-body p) { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
