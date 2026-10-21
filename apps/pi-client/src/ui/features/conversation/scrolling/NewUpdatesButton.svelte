<script lang="ts">
  let { count, onclick }: { count: number; onclick: () => void } = $props();
</script>

<button class="new-updates-button" type="button" {onclick} aria-label="Jump to latest activity">
  <span class="codicon codicon-arrow-down"></span>
  <span>{count > 0 ? `${count} new update${count === 1 ? "" : "s"}` : "Jump to latest"}</span>
</button>

<style>
.new-updates-button {
  position: absolute;
  z-index: 12;
  left: 50%;
  bottom: 11px;
  transform: translateX(-50%);
  max-width: calc(100% - 28px);
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--frost-border);
  border-radius: 999px;
  background: var(--frost-surface-raised);
  color: var(--frost-text);
  box-shadow: 0 5px 18px rgba(0,0,0,.24);
  cursor: pointer;
  font-size: 10.5px;
  white-space: nowrap;
}
.new-updates-button:hover { background: color-mix(in srgb, var(--frost-surface-raised) 80%, var(--frost-hover)); }
</style>
