<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { tick } from "svelte";

  import ResponseAnnotationWorkspace from "../features/annotation-review/ResponseAnnotationWorkspace.svelte";
  import { annotationReviewDrafts, discardAnnotationReview } from "../features/annotation-review/annotationReviewStore.svelte";
  import Composer from "../features/composer/Composer.svelte";
  import type { LocalComposerCommands } from "../features/composer/frostPiCommands";
  import type { ProviderUsageSource } from "../features/provider-usage/providerUsageSource";
  import { prefixDraftText } from "../features/composer/composerDraftSync";
  import { isQueuedPromptRecoveryPending, requestQueuedPromptRecovery } from "../features/composer/queuedPromptRecoveryStore.svelte";
  import ConversationView from "../features/conversation/ConversationView.svelte";
  import ExtensionUiHost from "../features/extension-ui/ExtensionUiHost.svelte";
  import SideQuestionCard from "../features/side-question/SideQuestionCard.svelte";
  import { showToast } from "../state/sessionViewStore.svelte";
  import ExtensionWidgets from "./ExtensionWidgets.svelte";
  import SessionMetrics from "./SessionMetrics.svelte";

  let {
    session,
    localCommands,
    providerUsageSource,
    restoreFailedSubmissionLocally,
    draftAuthority,
  }: {
    session: SessionViewModel;
    localCommands: LocalComposerCommands;
    providerUsageSource?: ProviderUsageSource | undefined;
    restoreFailedSubmissionLocally: boolean;
    draftAuthority: "webview" | "host";
  } = $props();
  let composer = $state<Composer>();
  let submissionPending = $state(false);

  const review = $derived($annotationReviewDrafts[session.id] ?? null);
  const aboveWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "above"));
  const belowWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "below"));

  async function insertAnnotations(prompt: string): Promise<void> {
    if (isQueuedPromptRecoveryPending(session.id) || session.queuedPromptRecovery.state === "recovering") {
      showToast("info", "Wait for pending message recovery to finish before inserting annotations.");
      return;
    }
    prefixDraftText(session.id, draftAuthority, prompt);
    discardAnnotationReview(session.id);
    await tick();
    composer?.focusAtEnd();
    showToast("info", "Annotations inserted into Composer. Nothing was sent.");
  }

  function restoreQueuedPrompts(): void {
    requestQueuedPromptRecovery(session, submissionPending);
  }

  function trackPendingSubmission(pending: boolean): void {
    submissionPending = pending;
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
  {#key session.id}<ConversationView {session} onrestore={restoreQueuedPrompts} {submissionPending} />{/key}
  <div class="composer-region">
    <SessionMetrics {session} {providerUsageSource} />
    <ExtensionWidgets widgets={aboveWidgets} />
    <ExtensionUiHost sessionId={session.id} requests={session.pendingExtensionUi} />
    {#if session.sideQuestion}
      {#key session.sideQuestion.id}<SideQuestionCard sessionId={session.id} question={session.sideQuestion} />{/key}
    {/if}
    <Composer bind:this={composer} {session} {localCommands} {restoreFailedSubmissionLocally} {draftAuthority} onpendingsubmissionchange={trackPendingSubmission} />
    <ExtensionWidgets widgets={belowWidgets} />
  </div>
{/if}

<style>
  .annotation-extension-ui { padding-top: 7px; }
</style>
