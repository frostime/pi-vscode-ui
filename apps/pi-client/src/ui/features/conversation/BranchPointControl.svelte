<script lang="ts">
  import type { BranchControlView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { requestBranchSwitch } from "./sessionTreeClient";

  let { control, session }: { control: BranchControlView; session: SessionViewModel } = $props();
</script>

<div class="branch-milestone">
  <span class="branch-milestone-line" aria-hidden="true"></span>
  <button
    class="branch-point-control"
    type="button"
    disabled={session.isNavigatingTree || !session.sessionTreeAvailable}
    aria-label={`Switch conversation branch; ${control.pathCount} paths`}
    title={session.sessionTreeAvailable
      ? "Switch conversation branch"
      : "Session tree navigation is unavailable. Update Pi, restart the session, and check FrostPi diagnostics."}
    onclick={() => requestBranchSwitch(session, control.branchPointId)}
  >
    <span class="codicon codicon-git-branch" aria-hidden="true"></span>
    <span>{control.pathCount} branches</span>
  </button>
  <span class="branch-milestone-line" aria-hidden="true"></span>
</div>

<style>
.branch-milestone {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(12px, 1fr) auto minmax(12px, 1fr);
  align-items: center;
  gap: 9px;
  margin: 4px 0 13px;
}
.branch-milestone-line { height: 1px; background: var(--frost-border-soft); }
.branch-point-control {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--frost-border);
  border-radius: 7px;
  background: var(--frost-bg);
  color: var(--frost-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.branch-point-control:hover:not(:disabled) { background: var(--frost-hover); color: var(--frost-text); }
.branch-point-control:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.branch-point-control:disabled { opacity: 0.55; cursor: default; }
.branch-point-control :global(.codicon) { flex: 0 0 auto; font-size: 12px; }

@media (max-width: 330px) {
  .branch-milestone { gap: 6px; }
  .branch-point-control { padding-inline: 7px; }
}
</style>
