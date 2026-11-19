<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { hasActiveBackgroundWorkers, subagentStopPickerCommand, type SubagentTarget } from "$shared/model/extensionUiModel";
  import { tick } from "svelte";
  import { postToHost } from "../bridge/hostBridge";

  import ResponseAnnotationWorkspace from "../features/annotation-review/ResponseAnnotationWorkspace.svelte";
  import { annotationReviewDrafts, discardAnnotationReview } from "../features/annotation-review/annotationReviewStore.svelte";
  import Composer from "../features/composer/Composer.svelte";
  import type { LocalComposerCommands } from "../features/composer/frostPiCommands";
  import type { ProviderUsageSource } from "../features/provider-usage/providerUsageSource";
  import { prefixDraftText } from "../features/composer/composerDraftSync";
  import { isQueuedPromptRecoveryPending, requestQueuedPromptRecovery } from "../features/composer/queuedPromptRecoveryStore.svelte";
  import ConversationView from "../features/conversation/ConversationView.svelte";
  import ExtensionUiHost from "../features/extension-ui/ExtensionUiHost.svelte";
  import SubagentActivity from "../features/extension-ui/SubagentActivity.svelte";
  import SubagentTranscriptPanel from "../features/extension-ui/SubagentTranscriptPanel.svelte";
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
  let worker = $state<{ sessionId: string; name: string; target: SubagentTarget; opener: HTMLElement }>();

  const review = $derived($annotationReviewDrafts[session.id] ?? null);
  const aboveWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "above" && !widget.subagents));
  const belowWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "below" && !widget.subagents));
  const workers = $derived(session.extensionWidgets.find(widget => widget.subagents));
  const inspectable = $derived((session.status === "ready" || session.status === "running") &&
    session.commands.some(command => command.source === "extension" && command.name === "subagents-inspect-rpc"));
  const currentWorker = $derived(inspectable && worker?.sessionId === session.id ? worker : undefined);
  const canStopWorkers = $derived((session.status === "ready" || session.status === "running") &&
    !session.isForking && !session.isNavigatingTree && hasActiveBackgroundWorkers(session.extensionWidgets) &&
    session.commands.some(command => command.source === "extension" && command.name === subagentStopPickerCommand));

  $effect(() => {
    if (!inspectable || worker?.sessionId !== session.id) worker = undefined;
  });

  function inspectWorker(name: string, target: SubagentTarget, opener: HTMLElement): void {
    if (currentWorker?.target.runId === target.runId && currentWorker.target.childId === target.childId) {
      void closeWorker();
    } else worker = { sessionId: session.id, name, target, opener };
  }

  async function closeWorker(): Promise<void> {
    const opener = currentWorker?.opener;
    worker = undefined;
    await tick();
    if (opener?.isConnected) opener.focus();
    else composer?.focusAtEnd();
  }

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
  <div class="conversation-area">
    {#key session.id}
      <div class="parent-conversation" inert={Boolean(currentWorker)}>
        <ConversationView {session} onrestore={restoreQueuedPrompts} {submissionPending} />
      </div>
    {/key}
    {#if currentWorker}
      {#key JSON.stringify([session.id, currentWorker.target])}
        <div class="worker-conversation">
          <SubagentTranscriptPanel sessionId={session.id} target={currentWorker.target} name={currentWorker.name} onclose={closeWorker} />
        </div>
      {/key}
    {/if}
  </div>
  <div class="composer-region" class:worker-inspection={Boolean(currentWorker)}>
    <SessionMetrics {session} {providerUsageSource} />
    <ExtensionWidgets widgets={aboveWidgets} />
    <SubagentActivity rows={workers?.subagents ?? []} {inspectable} selected={currentWorker?.target} onselect={inspectWorker}
      omitted={workers?.lines.at(-1) === "Additional activity omitted by Pi"}
      onstop={canStopWorkers ? () => postToHost({ type: "stopBackgroundWorkers", sessionId: session.id }) : undefined}
    />
    <ExtensionUiHost sessionId={session.id} requests={session.pendingExtensionUi} />
    <Composer bind:this={composer} {session} {localCommands} {restoreFailedSubmissionLocally} {draftAuthority} onpendingsubmissionchange={trackPendingSubmission} />
    <ExtensionWidgets widgets={belowWidgets} />
  </div>
{/if}

<style>
  .annotation-extension-ui { padding-top: 7px; }
  .conversation-area { position: relative; min-height: 0; min-width: 0; }
  .parent-conversation { height: 100%; min-height: 0; display: flex; flex-direction: column; }
  .worker-conversation { display: flex; position: absolute; inset: 0; max-width: var(--content-max-width); margin: 0 auto; padding: 7px; background: var(--frost-bg); }
  @media (max-height: 800px) {
    .worker-inspection :global(.extension-ui-card) { max-height: min(25vh, 185px); }
  }
</style>
