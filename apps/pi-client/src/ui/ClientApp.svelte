<script lang="ts">
  import { untrack } from "svelte";
import type { LocalComposerCommands } from "./features/composer/frostPiCommands";
  import type { SessionSummaryView } from "$shared/model/sessionViewModel";
  import type { ProviderUsageSource } from "./features/provider-usage/providerUsageSource";
  import { bridgeProviderUsageSource } from "./features/provider-usage/bridgeProviderUsageSource";
  import { clientCapabilities } from "./state/clientCapabilities.svelte";
  import { pruneAnnotationReviews } from "./features/annotation-review/annotationReviewStore.svelte";
  import OnboardingView from "./features/onboarding/OnboardingView.svelte";
  import PanelShell from "./shell/PanelShell.svelte";
  import SidebarShell from "./shell/SidebarShell.svelte";
  import { presentationStore, toastStore } from "./state/sessionViewStore.svelte";
  import { VSCODE_CLIENT_UI_CAPABILITIES, type ClientUiCapabilities } from "$shared/model/clientUiCapabilities";

  let {
    localComposerCommands,
    providerUsageSource = bridgeProviderUsageSource,
    capabilities = VSCODE_CLIENT_UI_CAPABILITIES,
    sidebarSessions,
  }: {
    localComposerCommands: LocalComposerCommands;
    /** Defaults to the host bridge request/response source; hosts with another provider backend inject it here. */
    providerUsageSource?: ProviderUsageSource | undefined;
    /** Defaults to the full VS Code capability set; hosts without editor integration must pass reduced capabilities. */
    capabilities?: ClientUiCapabilities | undefined;
    /** Optional navigation roster; the complete presentation still owns session lifetime. */
    sidebarSessions?: SessionSummaryView[] | undefined;
  } = $props();

  // One ClientApp root per document: set synchronously at mount (intentionally
  // reading the initial prop value) so host-message application after entry
  // wiring never sees the placeholder default; the effect covers prop changes.
  untrack(() => clientCapabilities.set(capabilities));
  $effect(() => {
    clientCapabilities.set(capabilities);
  });

  $effect(() => {
    const presentation = $presentationStore;
    const sessionIds = presentation.surface.kind === "panel"
      ? presentation.displayedSession ? [presentation.displayedSession.id] : []
      : [
          ...presentation.sessions.map(({ id }) => id),
          ...(presentation.displayedSession ? [presentation.displayedSession.id] : []),
        ];
    pruneAnnotationReviews(sessionIds);
  });
</script>

<main class="frostpi-root">
  {#if $presentationStore.surface.kind === "panel"}
    {#if $presentationStore.displayedSession}
      <PanelShell session={$presentationStore.displayedSession} localCommands={localComposerCommands} />
    {:else}
      <section class="removed-panel-session" role="status">This FrostPi Session is no longer available.</section>
    {/if}
  {:else if !$presentationStore.workspacePath}
    <OnboardingView noWorkspace />
  {:else if !$presentationStore.displayedSession}
    <OnboardingView />
  {:else}
    <SidebarShell
      sessions={sidebarSessions ?? $presentationStore.sessions}
      session={$presentationStore.displayedSession}
      externalized={$presentationStore.sidebarSessionExternalized}
      draftAuthority={$presentationStore.composerDraftAuthority}
      localCommands={localComposerCommands}
      {providerUsageSource}
    />
  {/if}

  <div class="toast-stack" aria-live="polite">
    {#each $toastStore as toast (toast.id)}
      <div class={`toast toast-${toast.level}`}>
        <span class={`codicon codicon-${toast.level === "error" ? "error" : toast.level === "warning" ? "warning" : "info"}`}></span>
        <span>{toast.message}</span>
      </div>
    {/each}
  </div>
</main>

<style>
.removed-panel-session { margin: auto; color: var(--frost-muted); }
.toast-stack {
  position: fixed;
  z-index: 150;
  right: 10px;
  bottom: 10px;
  width: min(360px, calc(100vw - 20px));
  display: grid;
  gap: 6px;
  pointer-events: none;
}
.toast {
  display: grid;
  grid-template-columns: 17px minmax(0,1fr);
  gap: 8px;
  padding: 9px 10px;
  background: var(--frost-surface-raised);
  border: 1px solid var(--frost-border);
  border-radius: 7px;
  box-shadow: var(--frost-shadow);
  animation: toast-in var(--motion-normal) ease-out;
  font-size: var(--font-size-detail);
}
.toast-error :global(.codicon) { color: var(--frost-error); }
.toast-warning :global(.codicon) { color: var(--frost-warning); }
.toast-info :global(.codicon) { color: var(--frost-link); }
</style>
