<script lang="ts">
  import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";

  import type { LocalComposerCommands } from "../features/composer/frostPiCommands";
  import type { ProviderUsageSource } from "../features/provider-usage/providerUsageSource";
  import OnboardingView from "../features/onboarding/OnboardingView.svelte";
  import { bridgeProviderUsageSource } from "../features/provider-usage/bridgeProviderUsageSource";
  import ExternalizedSessionView from "../features/sessions/ExternalizedSessionView.svelte";
  import SessionHeader from "../features/sessions/SessionHeader.svelte";
  import SessionInteraction from "./SessionInteraction.svelte";

  let {
    sessions,
    session,
    externalized,
    draftAuthority,
    localCommands,
    providerUsageSource = bridgeProviderUsageSource,
  }: {
    sessions: SessionSummaryView[];
    session: SessionViewModel;
    externalized: boolean;
    draftAuthority: "webview" | "host";
    localCommands: LocalComposerCommands;
    providerUsageSource?: ProviderUsageSource | undefined;
  } = $props();
</script>

<div class="app-shell">
  <SessionHeader {sessions} active={session} />
  {#if externalized}
    <ExternalizedSessionView {session} />
  {:else if session.status === "failed"}
    <OnboardingView {session} />
  {:else}
    <SessionInteraction
      {session}
      {localCommands}
      {providerUsageSource}
      restoreFailedSubmissionLocally={true}
      {draftAuthority}
    />
  {/if}
</div>
