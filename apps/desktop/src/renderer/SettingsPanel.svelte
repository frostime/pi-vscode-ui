<script lang="ts">
  import { tick, untrack } from "svelte";
  import { postToHost } from "@frostime/pi-client/ui/bridge/hostBridge";
  import { desktopSettingDefinitions, type DesktopSettingsAction, type DesktopSettingsTarget, type DesktopSettingsView } from "../shared/desktopSettings.js";
  import SettingRow from "./SettingRow.svelte";
  import { settingsPages, settingsByKey, matchesSettingSearch } from "./settingsPresentation.js";
  import { createSettingsDraft, settingDraftValue, changedSettingKeys, mergeSettingsDraft, parseSettingsDraft, type SettingsDraft } from "./settingsForm.js";

  let { view, target = "all", busy, error, onaction, onclose }: {
    view: DesktopSettingsView;
    target?: DesktopSettingsTarget;
    busy: boolean;
    error?: string;
    onaction: (action: DesktopSettingsAction) => Promise<DesktopSettingsView | null>;
    onclose: () => void;
  } = $props();

  type ReplacingOperation = "close" | "reload" | "importVscode" | "useDefaults";
  let panel = $state<HTMLDialogElement>();
  let content = $state<HTMLDivElement>();
  let keepEditing = $state<HTMLButtonElement>();
  let search = $state("");
  let pageId = $state("appearance");
  let customizedOnly = $state(false);
  let savedDraft = $state<SettingsDraft>({});
  let draft = $state<SettingsDraft>({});
  let fieldErrors = $state<Record<string, string>>({});
  let expanded = $state<Record<string, boolean>>({});
  let reviewing = $state(false);
  let pendingOperation = $state<ReplacingOperation | null>(null);
  let operation = $state<DesktopSettingsAction["type"] | null>(null);
  let discardTrigger: HTMLElement | null = null;
  let focusedTarget: DesktopSettingsTarget | undefined;

  const changedKeys = $derived(changedSettingKeys(savedDraft, draft));
  const hasChanges = $derived(changedKeys.length > 0);
  const processChanges = $derived(changedKeys.some((key) => settingsByKey[key]?.effect === "Next Pi start"));
  const filtering = $derived(Boolean(search.trim()) || customizedOnly);
  const page = $derived(settingsPages.find((entry) => entry.id === pageId)!);
  const visibleSections = $derived.by(() => {
    const pages = filtering ? settingsPages : [page];
    return pages.flatMap((entry) => entry.sections.map((section) => ({
      id: `${entry.id}-${section.title.toLowerCase().replace(/\W+/g, "-")}`,
      title: filtering ? `${entry.title} · ${section.title}` : section.title,
      settings: section.settings.filter((setting) => {
        if (customizedOnly && draft[setting.key] === undefined) return false;
        if (!matchesSettingSearch(setting, search)) return false;
        return filtering || setting.key !== "frostpi.network.proxy.endpoint"
          || settingDraftValue("frostpi.network.proxy.mode", draft) === "custom" || Boolean(fieldErrors[setting.key]);
      }),
    }))).filter((section) => section.settings.length > 0);
  });
  const visibleCount = $derived(visibleSections.reduce((count, section) => count + section.settings.length, 0));

  $effect(() => {
    const incoming = view;
    // Explicit operations own their results; an import is a draft, not a saved baseline.
    // External Zoom/theme updates still reach untouched fields without discarding edits.
    untrack(() => {
      if (operation !== null) return;
      if (!hasChanges) replaceDraft(incoming);
      else {
        const next = mergeSettingsDraft(savedDraft, draft, incoming.values);
        savedDraft = next.saved;
        draft = next.draft;
      }
    });
  });

  $effect(() => {
    const requested = target;
    if (!panel || busy) return;
    if (requested === "all") { focusedTarget = undefined; return; }
    if (focusedTarget === requested) return;
    focusedTarget = requested;
    untrack(() => revealSetting(requested));
  });

  $effect(() => {
    if (pendingOperation) queueMicrotask(() => keepEditing?.focus());
  });

  function replaceDraft(next: DesktopSettingsView): void {
    const values = createSettingsDraft(next.values);
    savedDraft = values;
    draft = { ...values };
    fieldErrors = {};
    reviewing = false;
  }

  function selectPage(id: string): void {
    pageId = id;
    search = "";
    customizedOnly = false;
    if (content) content.scrollTop = 0;
  }

  function updateField(key: string, value: string | boolean): void {
    draft[key] = value;
    delete fieldErrors[key];
  }

  function resetField(key: string): void {
    delete draft[key];
    delete fieldErrors[key];
  }

  async function focusField(key: string): Promise<void> {
    await tick();
    if (!panel?.isConnected) return;
    const field = panel.ownerDocument.getElementById(`setting-${key}`);
    const row = panel.querySelector<HTMLElement>(`[data-setting-key="${key}"]`);
    field?.focus();
    (field ?? row)?.scrollIntoView({ block: "center" });
  }

  function revealSetting(key: string): void {
    const owner = settingsPages.find((entry) => entry.sections.some((section) => section.settings.some((setting) => setting.key === key)));
    if (!owner) return;
    selectPage(owner.id);
    if (["array", "object"].includes(desktopSettingDefinitions[key]!.type)) expanded[key] = true;
    void focusField(key);
  }

  function discard(): void {
    draft = { ...savedDraft };
    fieldErrors = {};
    reviewing = false;
  }

  async function act(action: DesktopSettingsAction): Promise<void> {
    if (busy || operation) return;
    operation = action.type;
    try {
      const result = await onaction(action);
      if (!result) return;
      if (action.type === "importVscode") {
        draft = createSettingsDraft(result.values);
        fieldErrors = {};
      } else if (action.type === "openFile") {
        const next = mergeSettingsDraft(savedDraft, draft, result.values);
        savedDraft = next.saved;
        draft = next.draft;
      } else replaceDraft(result);
    } finally { operation = null; }
  }

  function requestOperation(next: ReplacingOperation): void {
    if (busy || operation) return;
    if (hasChanges) {
      discardTrigger = panel?.ownerDocument.activeElement instanceof HTMLElement ? panel.ownerDocument.activeElement : null;
      pendingOperation = next;
    } else performOperation(next);
  }

  function performOperation(next: ReplacingOperation): void {
    if (next === "close") onclose();
    else void act({ type: next });
  }

  function cancelDiscard(): void {
    pendingOperation = null;
    discardTrigger?.focus();
  }

  function confirmDiscard(): void {
    const next = pendingOperation;
    pendingOperation = null;
    if (next) { discard(); performOperation(next); }
  }

  async function save(): Promise<void> {
    if (busy || view.error) return;
    const parsed = parseSettingsDraft(draft);
    fieldErrors = parsed.errors;
    const firstError = Object.keys(parsed.errors)[0];
    if (firstError) { revealSetting(firstError); return; }
    await act({ type: "save", values: parsed.values });
  }

  function openDialog(element: HTMLDialogElement): { destroy(): void } {
    element.showModal();
    return { destroy: () => element.close() };
  }
</script>

<dialog class="settings-dialog" bind:this={panel} use:openDialog aria-labelledby="settings-title"
  oncancel={(event) => { event.preventDefault(); if (pendingOperation) cancelDiscard(); else requestOperation("close"); }}>
  <div class="settings-frame" inert={pendingOperation !== null}>
    <header>
      <div><h2 id="settings-title">Settings</h2><p>Desktop application · independent of VS Code</p></div>
      <button type="button" class="close" aria-label="Close settings" disabled={busy} onclick={() => requestOperation("close")}>Close</button>
    </header>
    <form novalidate onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <div class="toolbar">
        <label class="search-box"><span class="codicon codicon-search" aria-hidden="true"></span>
          <input type="search" aria-label="Search settings" placeholder="Search settings or paste a key…" bind:value={search} oninput={() => { if (content) content.scrollTop = 0; }} onkeydown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
        </label>
        <button type="button" class="filter" aria-pressed={customizedOnly} onclick={() => customizedOnly = !customizedOnly}>Customized</button>
      </div>
      <select class="mobile-category" aria-label="Settings category" value={pageId} onchange={(event) => selectPage(event.currentTarget.value)}>
        {#each settingsPages as entry (entry.id)}<option value={entry.id}>{entry.title}</option>{/each}
      </select>
      <div class="settings-workspace">
        <nav class="categories" aria-label="Settings categories">
          {#each settingsPages as entry (entry.id)}
            <button type="button" aria-current={!filtering && entry.id === pageId ? "page" : undefined} onclick={() => selectPage(entry.id)}>
              <span class={`codicon codicon-${entry.icon}`} aria-hidden="true"></span><span>{entry.title}</span>
              <small>{entry.sections.reduce((count, section) => count + section.settings.length, 0)}</small>
            </button>
          {/each}
        </nav>
        <div class="settings-body" bind:this={content}>
          <div class="content-inner">
            {#if view.firstRun}
              <section class="setup notice" aria-labelledby="first-run-title">
                <h3 id="first-run-title">Set up Desktop settings</h3>
                <p>Start with defaults, or preview settings from the default VS Code user configuration. Import does not save or synchronize either file.</p>
                <div class="actions"><button type="button" disabled={busy} onclick={() => requestOperation("importVscode")}>Import VS Code defaults</button><button type="button" disabled={busy} onclick={() => requestOperation("useDefaults")}>Use defaults</button></div>
              </section>
            {/if}
            {#each view.notices as notice (notice)}<p class="notice" role="status">{notice}</p>{/each}
            {#if view.error}
              <div class="error notice" role="alert"><p>{view.error}</p><p>Open settings.json from the file menu, repair it, then Reload. Save is disabled to preserve the damaged file.</p></div>
            {/if}
            {#if error}<p class="error notice" role="alert">{error}</p>{/if}
            {#if Object.keys(fieldErrors).length}
              <div class="error notice" role="alert"><p>Check the highlighted settings:</p>
                {#each Object.keys(fieldErrors) as key (key)}<button type="button" class="error-link" onclick={() => revealSetting(key)}>{settingsByKey[key]!.label}</button>{/each}
              </div>
            {/if}
            <h2 class="section-title">{filtering ? search.trim() ? "Search results" : "Customized settings" : page.title}</h2>
            <p class="section-description">{filtering ? `${visibleCount} settings across all categories` : page.description}</p>
            {#each visibleSections as section (section.id)}
              <section class="setting-group" aria-labelledby={`section-${section.id}`}>
                <h3 id={`section-${section.id}`}>{section.title}</h3>
                <div class="group-card">
                  {#each section.settings as setting (setting.key)}
                    <SettingRow {setting} definition={desktopSettingDefinitions[setting.key]!} value={settingDraftValue(setting.key, draft)}
                      explicit={draft[setting.key] !== undefined} expanded={expanded[setting.key] ?? false} busy={busy || Boolean(view.error)} error={fieldErrors[setting.key] ?? ""}
                      onchange={(value) => updateField(setting.key, value)} onreset={() => resetField(setting.key)}
                      onexpand={(value) => expanded[setting.key] = value} oncopy={() => postToHost({ type: "copyText", text: setting.key })} />
                  {/each}
                </div>
              </section>
            {:else}
              <p class="empty-results">No matching settings. Try a label or an exact key.</p>
            {/each}
          </div>
        </div>
      </div>
      {#if reviewing && hasChanges}
        <section class="changes" aria-label="Unsaved setting changes">
          <h3>Review changes</h3>
          {#each changedKeys as key (key)}
            <div class="change-row"><span>{settingsByKey[key]!.label}</span><code>{savedDraft[key] ?? "Default"} → {draft[key] ?? "Default"}</code></div>
          {/each}
        </section>
      {/if}
      <footer>
        <div class="save-status" aria-live="polite">{busy ? "Updating settings…" : hasChanges ? `${changedKeys.length} unsaved change${changedKeys.length === 1 ? "" : "s"}` : "No unsaved changes"}
          {#if processChanges}<small>Process changes apply on the next Pi start. Saving never restarts Pi.</small>{/if}
        </div>
        <div class="footer-actions">
          <details class="file-menu"><summary aria-label="Settings file actions">⋯</summary>
            <div class="file-actions"><p class="file-path">{view.filePath}</p>
              <button type="button" disabled={busy || view.firstRun} onclick={() => void act({ type: "openFile" })}>Open settings.json</button>
              <button type="button" disabled={busy} onclick={() => requestOperation("reload")}>Reload</button>
            </div>
          </details>
          <button type="button" class="review" disabled={busy || !hasChanges} aria-expanded={reviewing} onclick={() => reviewing = !reviewing}>Review changes</button>
          <button type="button" disabled={busy || !hasChanges} onclick={discard}>Discard</button>
          <button type="submit" class="save" disabled={busy || Boolean(view.error) || (!hasChanges && !view.firstRun)}>Save</button>
        </div>
      </footer>
    </form>
  </div>
  {#if pendingOperation}
    <div class="discard-overlay">
      <div class="discard-dialog" role="alertdialog" aria-modal="true" tabindex="-1" aria-labelledby="discard-title" aria-describedby="discard-message">
        <h3 id="discard-title">Discard unsaved changes?</h3>
        <p id="discard-message">Your saved settings have not changed. Keep editing, or discard this draft to continue.</p>
        <div class="actions"><button type="button" bind:this={keepEditing} onclick={cancelDiscard}>Keep editing</button><button type="button" class="primary" onclick={confirmDiscard}>Discard changes</button></div>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .settings-dialog { box-sizing: border-box; padding: 0; margin: auto; width: min(1100px, calc(100vw - 32px)); height: min(760px, calc(100dvh - 32px)); max-width: none; max-height: none; overflow: hidden; border: 1px solid var(--frost-border); border-radius: 8px; background: var(--frost-bg-alt); color: var(--frost-text); font: var(--font-size-ui) var(--font-ui); }
  .settings-dialog::backdrop { background: #0008; }
  .settings-frame { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 17px 22px 12px; }
  header h2 { font-size: calc(var(--font-size-ui) + 6px); font-weight: 600; margin: 0; }
  header p { font-size: var(--font-size-detail); margin: 4px 0 0; }
  p { color: var(--frost-muted); line-height: 1.55; overflow-wrap: anywhere; }
  button, input, select { font: inherit; }
  button { max-width: 100%; padding: 6px 11px; border: 1px solid var(--frost-border); border-radius: 4px; background: var(--frost-secondary-bg); color: var(--frost-text); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--frost-secondary-hover); }
  button:disabled { opacity: .5; cursor: default; }
  .close { background: transparent; border-color: transparent; color: var(--frost-muted); }
  form { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .toolbar { flex: none; display: flex; align-items: center; gap: 9px; padding: 0 22px 14px; }
  .search-box { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
  .search-box .codicon { position: absolute; left: 10px; color: var(--frost-muted); font-size: 13px; }
  .search-box input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 10px 8px 31px; border: 1px solid var(--frost-input-border); border-radius: 4px; background: var(--frost-input-bg); color: var(--frost-text); }
  .filter { color: var(--frost-muted); white-space: nowrap; }
  .filter[aria-pressed="true"] { color: var(--frost-link); border-color: var(--frost-focus); }
  .mobile-category { display: none; margin: 0 16px 12px; padding: 7px 9px; min-width: 0; border: 1px solid var(--frost-input-border); border-radius: 4px; background: var(--frost-input-bg); color: var(--frost-text); }
  .settings-workspace { display: flex; flex: 1; min-height: 0; border-top: 1px solid var(--frost-border); }
  .categories { flex: 0 0 190px; padding: 16px 12px; background: var(--frost-bg); border-right: 1px solid var(--frost-border); overflow: auto; }
  .categories button { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 36px; padding: 7px 9px; text-align: left; color: var(--frost-muted); background: transparent; border: 0; }
  .categories button:hover { background: var(--frost-hover); }
  .categories button[aria-current="page"] { color: var(--frost-text); background: color-mix(in srgb, var(--frost-active) 55%, transparent); }
  .categories button > span:not(.codicon) { flex: 1; }
  .categories .codicon { flex: none; font-size: 14px; }
  .categories small { flex: none; font-size: calc(var(--font-size-ui) - 3px); }
  .settings-body { flex: 1; min-width: 0; min-height: 0; padding: 24px 28px 32px; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .content-inner { max-width: 820px; margin: 0 auto; }
  .section-title { font-size: calc(var(--font-size-ui) + 6px); font-weight: 600; margin: 0; }
  .section-description { font-size: var(--font-size-compact); margin: 6px 0 22px; }
  .setting-group > h3 { margin: 22px 4px 9px; color: var(--frost-muted); font-size: var(--font-size-compact); font-weight: 500; }
  .group-card { min-width: 0; border: 1px solid var(--frost-border); border-radius: 8px; background: var(--frost-surface); }
  .notice { padding: 11px 12px; margin: 0 0 14px; border: 1px solid var(--frost-border); border-radius: 5px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 1.5px); }
  .notice p { margin: 0 0 8px; }
  .notice p:last-child { margin-bottom: 0; }
  .setup h3 { margin: 0 0 7px; color: var(--frost-text); font-size: calc(var(--font-size-ui) + 1px); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .error, .error p { color: var(--frost-error); }
  .error-link { padding: 2px 6px; border-color: transparent; background: transparent; color: inherit; text-decoration: underline; }
  .empty-results { font-size: var(--font-size-compact); padding: 24px 0; }
  footer { flex: none; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 22px; border-top: 1px solid var(--frost-border); }
  .save-status { font-size: var(--font-size-detail); color: var(--frost-muted); }
  .save-status small { display: block; max-width: 320px; font-size: calc(var(--font-size-ui) - 3px); margin-top: 3px; }
  .footer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
  .review { border-color: transparent; background: transparent; color: var(--frost-muted); }
  .save, .primary { color: var(--frost-accent-text); background: var(--frost-accent); border-color: var(--frost-accent); }
  .save:hover:not(:disabled), .primary:hover:not(:disabled) { background: var(--frost-accent-hover); }
  .file-menu { position: relative; }
  .file-menu summary { list-style: none; cursor: pointer; padding: 5px 10px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-muted); }
  .file-actions { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 3; width: min(280px, calc(100vw - 48px)); padding: 7px; border: 1px solid var(--frost-border); border-radius: 5px; background: var(--frost-surface-raised); box-shadow: var(--frost-shadow); }
  .file-actions button { display: block; width: 100%; text-align: left; border: 0; background: transparent; }
  .file-actions button:hover { background: var(--frost-hover); }
  .file-path { padding: 5px 7px; margin: 0 0 5px; font: calc(var(--font-size-ui) - 3px)/1.6 var(--font-mono); user-select: text; }
  .changes { flex: none; max-height: 180px; overflow: auto; padding: 12px 22px; border-top: 1px solid var(--frost-border); background: var(--frost-surface); }
  .changes h3 { font-size: var(--font-size-compact); margin: 0 0 7px; }
  .change-row { display: flex; justify-content: space-between; gap: 18px; padding: 6px 0; font-size: var(--font-size-detail); }
  .change-row code { max-width: 55%; color: var(--frost-muted); overflow-wrap: anywhere; white-space: pre-wrap; font: calc(var(--font-size-ui) - 3px)/1.5 var(--font-mono); }
  .discard-overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: #0008; }
  .discard-dialog { box-sizing: border-box; width: 360px; max-width: 100%; padding: 22px; border: 1px solid var(--frost-border); border-radius: 7px; background: var(--frost-surface-raised); }
  .discard-dialog h3 { font-size: calc(var(--font-size-ui) + 3px); margin: 0 0 8px; }
  .discard-dialog p { font-size: var(--font-size-compact); margin-bottom: 20px; }
  .discard-dialog .actions { justify-content: flex-end; }
  :is(button, input, select, summary):focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  @media (max-width: 720px) {
    .settings-dialog { width: calc(100vw - 16px); height: calc(100dvh - 16px); }
    header { padding: 14px 16px 12px; }
    header p { display: none; }
    header h2 { font-size: calc(var(--font-size-ui) + 4px); }
    .toolbar { padding: 0 16px 12px; flex-wrap: wrap; }
    .search-box { flex-basis: 100%; }
    .mobile-category { display: block; }
    .categories { display: none; }
    .settings-body { padding: 18px 14px 28px; }
    footer { padding: 10px 14px; }
    .save-status { flex: 1 1 100%; }
    .footer-actions { margin-left: auto; justify-content: flex-end; }
    .changes { padding: 10px 14px; }
  }
</style>
