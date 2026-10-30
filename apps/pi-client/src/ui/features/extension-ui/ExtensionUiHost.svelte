<script lang="ts">
  import type { PendingExtensionUiView, PendingQuestionUiView, PendingStandardExtensionUiView } from "$shared/model/extensionUiModel";

  import QuestionToolHost from "../question-tool/QuestionToolHost.svelte";
  import ExtensionUiRequestCard from "./ExtensionUiRequestCard.svelte";

  let { sessionId, requests }: { sessionId: string; requests: PendingExtensionUiView[] } = $props();
  const questionRequests = $derived(requests.filter((request): request is PendingQuestionUiView => request.method === "question"));
  const standardRequests = $derived(requests.filter((request): request is PendingStandardExtensionUiView => request.method !== "question"));
</script>

<QuestionToolHost {sessionId} requests={questionRequests} />

{#if standardRequests.length}
  <div class="extension-ui-host">
    {#each standardRequests as request (request.id)}
      <ExtensionUiRequestCard {sessionId} {request} />
    {/each}
  </div>
{/if}

<style>
.extension-ui-host { width: 100%; max-width: var(--content-max-width); max-height: min(40vh, 360px); min-height: 0; margin: 0 auto 7px; display: grid; gap: 6px; overflow-y: auto; }
</style>
