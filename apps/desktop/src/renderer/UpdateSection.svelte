<script lang="ts">
  import type { DesktopUpdateAction, DesktopUpdateView } from "../shared/desktopUpdates.js";

  // Content only: the Settings dialog owns the entry, search, draft and close guard.
  let { view, error = "", onaction }: {
    view: DesktopUpdateView | null;
    error?: string;
    onaction: (action: DesktopUpdateAction) => void;
  } = $props();

  const busy = $derived(view !== null && view.operation !== "idle");
  const availableVersion = $derived(view?.available?.version ?? (view?.checked ? "Up to date" : "Not checked"));
  const downloadedVersion = $derived(view?.downloaded?.version ?? "None");
  const downloadLabel = $derived(view?.available ? `Download ${view.available.version}` : "Download update");
  const installLabel = $derived(view?.downloaded ? `Install ${view.downloaded.version} and restart` : "Install downloaded update");
  const downloading = $derived(view?.operation === "downloading" ? view.progress : undefined);

  function size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<section class="update-section" aria-labelledby="update-heading">
  <h3 id="update-heading">Application updates</h3>
  <p class="intro">Checking and downloading never close sessions. Installing uses the package already downloaded on this PC: close every session first, then Desktop saves its data, closes, and Windows Installer asks for permission. Desktop opens again when the update finishes.</p>
  {#if !view}
    <p class="status" role="status">Reading update status…</p>
  {:else}
    <dl class="facts">
      <div><dt>Current version</dt><dd>{view.currentVersion}</dd></div>
      <div><dt>Available version</dt><dd>{availableVersion}</dd></div>
      <div><dt>Downloaded version</dt><dd>{downloadedVersion}</dd></div>
    </dl>
    {#if view.available?.notes}<p class="notes">{view.available.notes}</p>{/if}
    {#if !view.configured}
      <p class="notice">Check and download are disabled. This build has no trusted update source configured.</p>
    {/if}
    {#if view.operation === "checking"}
      <p class="status" role="status">Checking for updates…</p>
    {:else if downloading}
      <p class="status" role="status">Downloading {downloading.totalBytes
        ? `${size(downloading.receivedBytes)} of ${size(downloading.totalBytes)}`
        : size(downloading.receivedBytes)}…</p>
    {:else if view.operation === "preparingInstall"}
      <p class="status" role="status">Preparing to install {view.downloaded?.version ?? "the downloaded update"}. Session data is saved before Desktop closes; Windows Installer continues and Desktop opens again when it finishes.</p>
    {/if}
    {#if view.error}<p class="error" role="alert">{view.error}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if view.installBlock?.reason === "sessions"}
      <p class="blocked" role="status">Close all sessions before installing. {view.installBlock.count}
        {view.installBlock.count === 1 ? "session is" : "sessions are"} still open across every Project, including stopped sessions.</p>
    {:else if view.installBlock?.reason === "opening"}
      <p class="blocked" role="status">Finish or cancel the current New or Resume operation before installing.</p>
    {/if}
    {#if view.downloaded}
      <p class="install-note">Installing {view.downloaded.version} runs Windows Installer on the downloaded package; it is not downloaded again, and Desktop reopens afterwards.</p>
    {/if}
    <div class="actions">
      <button type="button" disabled={!view.configured || busy} onclick={() => onaction({ type: "check" })}>Check for updates</button>
      <button type="button" disabled={!view.configured || busy || !view.available || view.available.version === view.downloaded?.version}
        onclick={() => onaction({ type: "download" })}>{downloadLabel}</button>
      <button type="button" class="primary" disabled={!view.configured || busy || !view.downloaded || Boolean(view.installBlock)}
        onclick={() => onaction({ type: "install" })}>{installLabel}</button>
    </div>
  {/if}
</section>

<style>
  .update-section h3 { margin: 0; font-size: calc(var(--font-size-ui) + 2px); font-weight: 600; }
  .intro { font-size: var(--font-size-compact); margin: 6px 0 18px; }
  .install-note { font-size: var(--font-size-detail); color: var(--frost-muted); margin: 0 0 12px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 0 0 16px; padding: 14px; border: 1px solid var(--frost-border); border-radius: 8px; background: var(--frost-surface); }
  .facts dt { font-size: var(--font-size-detail); color: var(--frost-muted); margin-bottom: 4px; }
  .facts dd { margin: 0; font: calc(var(--font-size-ui) - 1px)/1.4 var(--font-mono); overflow-wrap: anywhere; }
  .notes { font-size: var(--font-size-detail); max-height: 160px; overflow: auto; padding: 10px 12px; border: 1px solid var(--frost-border); border-radius: 6px; white-space: pre-wrap; }
  .notice, .blocked { padding: 11px 12px; border: 1px solid var(--frost-border); border-radius: 5px; font-size: calc(var(--font-size-ui) - 1.5px); margin: 0 0 14px; }
  .blocked { border-color: var(--frost-focus); color: var(--frost-text); }
  .status { font-size: var(--font-size-compact); margin: 0 0 14px; }
  .error { font-size: var(--font-size-compact); color: var(--frost-error); margin: 0 0 14px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { font: inherit; max-width: 100%; padding: 6px 11px; border: 1px solid var(--frost-border); border-radius: 4px; background: var(--frost-secondary-bg); color: var(--frost-text); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--frost-secondary-hover); }
  button:disabled { opacity: .5; cursor: default; }
  .primary { color: var(--frost-accent-text); background: var(--frost-accent); border-color: var(--frost-accent); }
  .primary:hover:not(:disabled) { background: var(--frost-accent-hover); }
  button:focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
</style>
