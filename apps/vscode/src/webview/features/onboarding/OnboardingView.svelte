<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { postToHost } from "../../bridge/vscodeBridge";

  let { session = null, noWorkspace = false }: { session?: SessionViewModel | null; noWorkspace?: boolean } = $props();
</script>

<div class="onboarding-view">
  <div class="onboarding-logo"><span>π</span></div>
  {#if noWorkspace}
    <h1>Open a workspace</h1>
    <p>FrostPi runs Pi in the workspace extension host so its files, tools, and shell environment match the project you are editing.</p>
    <button class="primary" type="button" onclick={() => postToHost({ type: "openFolder" })}>
      <span class="codicon codicon-folder-opened"></span> Open folder
    </button>
  {:else if session?.status === "failed"}
    <h1>Pi could not start</h1>
    <p class="onboarding-error">{session.error ?? "Unknown startup error"}</p>
    <div class="onboarding-actions">
      {#if !session.isEphemeral}
        <button class="primary" type="button" onclick={() => postToHost({ type: "retryStart", sessionId: session.id })}>
          <span class="codicon codicon-refresh"></span> Retry
        </button>
      {/if}
      <button type="button" onclick={() => postToHost({ type: "configureExecutable" })}>
        <span class="codicon codicon-terminal"></span> Configure Pi
      </button>
      <button type="button" onclick={() => postToHost({ type: "openSettings" })}>
        <span class="codicon codicon-settings-gear"></span> Settings
      </button>
    </div>
    <p class="onboarding-note">FrostPi expects a working Pi installation and uses its existing providers, extensions, skills, prompts, and session storage.</p>
  {:else}
    <h1>Start a Pi session</h1>
    <p>Create a session to begin working with Pi in this workspace.</p>
    <div class="onboarding-actions">
      <button class="primary" type="button" onclick={() => postToHost({ type: "createSession" })}>
        <span class="codicon codicon-add"></span> New session
      </button>
      <button type="button" onclick={() => postToHost({ type: "resumeSession" })}>
        <span class="codicon codicon-history"></span> Resume session
      </button>
    </div>
  {/if}
</div>

<style>
.onboarding-logo {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid var(--frost-border);
  border-radius: 16px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--frost-surface) 80%, transparent), color-mix(in srgb, var(--frost-bg-alt) 90%, transparent));
  box-shadow: inset 0 1px rgba(255,255,255,.05), 0 10px 25px rgba(0,0,0,.12);
}
.onboarding-logo :global(span) {
  font-family: Georgia, serif;
  font-size: 24px;
  color: color-mix(in srgb, var(--frost-text) 88%, var(--frost-link));
}
.onboarding-actions :global(button) {
  padding: 5px 10px;
  border-radius: 5px;
  background: var(--frost-secondary-bg);
  cursor: pointer;
  font-size: 11px;
}
.onboarding-view > :global(button) {
  padding: 5px 10px;
  border-radius: 5px;
  background: var(--frost-secondary-bg);
  cursor: pointer;
  font-size: 11px;
}
.onboarding-actions :global(button:hover) { background: var(--frost-secondary-hover); }
.onboarding-view > :global(button:hover) { background: var(--frost-secondary-hover); }
.onboarding-actions :global(.primary) { background: var(--frost-accent); color: var(--frost-accent-text); }
.onboarding-view > :global(.primary) { background: var(--frost-accent); color: var(--frost-accent-text); }
.onboarding-actions :global(.primary:hover) { background: var(--frost-accent-hover); }
.onboarding-view > :global(.primary:hover) { background: var(--frost-accent-hover); }
.onboarding-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}
.onboarding-view :global(h1) { margin: 16px 0 5px; font-size: 17px; font-weight: 600; }
.onboarding-view :global(p) { max-width: 450px; margin: 0 0 14px; color: var(--frost-muted); font-size: 11px; }
.onboarding-error {
  max-height: 160px;
  overflow: auto;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--frost-error) 8%, var(--frost-surface));
  border: 1px solid color-mix(in srgb, var(--frost-error) 35%, var(--frost-border));
  border-radius: 6px;
  color: var(--frost-error) !important;
  text-align: left;
  white-space: pre-wrap;
  font-family: var(--font-mono);
}
.onboarding-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; margin-bottom: 14px; }
.onboarding-actions :global(button) { display: inline-flex; align-items: center; gap: 6px; }
.onboarding-note { opacity: .8; }
</style>
