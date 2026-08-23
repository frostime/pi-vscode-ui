<script lang="ts">
  import OnboardingView from "./features/onboarding/OnboardingView.svelte";
  import PanelShell from "./shell/PanelShell.svelte";
  import SidebarShell from "./shell/SidebarShell.svelte";
  import { presentationStore, toastStore } from "./state/sessionViewStore.svelte";
</script>

<main class="frostpi-root">
  {#if $presentationStore.surface.kind === "panel"}
    {#if $presentationStore.displayedSession}
      <PanelShell session={$presentationStore.displayedSession} />
    {:else}
      <section class="removed-panel-session" role="status">This FrostPi Session is no longer available.</section>
    {/if}
  {:else if !$presentationStore.workspacePath}
    <OnboardingView noWorkspace />
  {:else if !$presentationStore.displayedSession}
    <OnboardingView />
  {:else}
    <SidebarShell
      sessions={$presentationStore.sessions}
      session={$presentationStore.displayedSession}
      externalized={$presentationStore.sidebarSessionExternalized}
      draftAuthority={$presentationStore.composerDraftAuthority}
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
  font-size: 11px;
}
.toast-error :global(.codicon) { color: var(--frost-error); }
.toast-warning :global(.codicon) { color: var(--frost-warning); }
.toast-info :global(.codicon) { color: var(--frost-link); }
</style>
