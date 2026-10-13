<script lang="ts">
  import { tick } from "svelte";
  import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";

  import OnboardingView from "../features/onboarding/OnboardingView.svelte";
  import ExternalizedSessionView from "../features/sessions/ExternalizedSessionView.svelte";
  import SessionHeader from "../features/sessions/SessionHeader.svelte";
  import SessionInteraction from "./SessionInteraction.svelte";
  import ProviderUsagePanel from "../features/provider-usage/ProviderUsagePanel.svelte";
  import { mockProviderUsageSource } from "../features/provider-usage/mockProviderUsage";

  let {
    sessions,
    session,
    externalized,
    draftAuthority,
  }: {
    sessions: SessionSummaryView[];
    session: SessionViewModel;
    externalized: boolean;
    draftAuthority: "webview" | "host";
  } = $props();

  let usageOpen = $state(false);
  let usageReturnFocus: HTMLButtonElement | null = null;

  function openProviderUsage(returnFocus: HTMLButtonElement | null): void {
    usageReturnFocus = returnFocus;
    usageOpen = true;
  }

  async function closeProviderUsage(): Promise<void> {
    usageOpen = false;
    await tick();
    if (usageReturnFocus?.isConnected) usageReturnFocus.focus();
  }
</script>

<div class="app-shell">
  <SessionHeader {sessions} active={session} onopenProviderUsage={openProviderUsage} />
  {#if externalized}
    <ExternalizedSessionView {session} />
  {:else if session.status === "failed"}
    <OnboardingView {session} />
  {:else}
    <SessionInteraction {session} surfaceKind="sidebar" {draftAuthority} />
  {/if}
  {#if usageOpen}
    <ProviderUsagePanel source={mockProviderUsageSource} currentProviderId={session.model?.provider} mockData onclose={() => void closeProviderUsage()} />
  {/if}
</div>
