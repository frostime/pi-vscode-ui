<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { tick } from "svelte";

  import ResponseAnnotationWorkspace from "../features/annotation-review/ResponseAnnotationWorkspace.svelte";
  import { annotationReviewDrafts, discardAnnotationReview } from "../features/annotation-review/annotationReviewStore.svelte";
  import Composer from "../features/composer/Composer.svelte";
  import { prefixDraftText } from "../features/composer/composerDraftSync";
  import ConversationView from "../features/conversation/ConversationView.svelte";
  import ExtensionUiHost from "../features/extension-ui/ExtensionUiHost.svelte";
  import { showToast } from "../state/sessionViewStore.svelte";
  import ExtensionWidgets from "./ExtensionWidgets.svelte";
  import SessionMetrics from "./SessionMetrics.svelte";

  let {
    session,
    surfaceKind,
    draftAuthority,
  }: {
    session: SessionViewModel;
    surfaceKind: "sidebar" | "panel";
    draftAuthority: "webview" | "host";
  } = $props();
  let composer = $state<Composer>();

  const review = $derived($annotationReviewDrafts[session.id] ?? null);
  const aboveWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "above"));
  const belowWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "below"));

  async function insertAnnotations(prompt: string): Promise<void> {
    prefixDraftText(session.id, draftAuthority, prompt);
    discardAnnotationReview(session.id);
    await tick();
    composer?.focusAtEnd();
    showToast("info", "Annotations inserted into Composer. Nothing was sent.");
  }
</script>

{#if review}
  {#key session.id}
    <ResponseAnnotationWorkspace sessionId={session.id} {review} oninsert={insertAnnotations} />
  {/key}
  {#if session.pendingExtensionUi.length > 0}
    <div class="composer-region annotation-extension-ui">
      <ExtensionUiHost sessionId={session.id} requests={session.pendingExtensionUi} />
    </div>
  {/if}
{:else}
  {#key session.id}<ConversationView {session} />{/key}
  <div class="composer-region">
    <SessionMetrics {session} />
    <ExtensionWidgets widgets={aboveWidgets} />
    <ExtensionUiHost sessionId={session.id} requests={session.pendingExtensionUi} />
    <Composer bind:this={composer} {session} {surfaceKind} {draftAuthority} />
    <ExtensionWidgets widgets={belowWidgets} />
  </div>
{/if}

<style>
  .annotation-extension-ui { padding-top: 7px; }
</style>
