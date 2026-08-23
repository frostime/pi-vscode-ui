<script lang="ts">
  import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";

  import OnboardingView from "../features/onboarding/OnboardingView.svelte";
  import ExternalizedSessionView from "../features/sessions/ExternalizedSessionView.svelte";
  import SessionHeader from "../features/sessions/SessionHeader.svelte";
  import SessionInteraction from "./SessionInteraction.svelte";

  let {
    sessions,
    session,
    externalized,
  }: { sessions: SessionSummaryView[]; session: SessionViewModel; externalized: boolean } = $props();
</script>

<div class="app-shell">
  <SessionHeader {sessions} active={session} />
  {#if externalized}
    <ExternalizedSessionView {session} />
  {:else if session.status === "failed"}
    <OnboardingView {session} />
  {:else}
    <SessionInteraction {session} surfaceKind="sidebar" />
  {/if}
</div>
