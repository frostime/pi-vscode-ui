<script lang="ts">
  import { tick } from "svelte";
  import type { SettingDefinition } from "../shared/desktopSettings.js";
  import { formatSettingValue, type SettingPresentation } from "./settingsPresentation.js";

  let { setting, definition, value, explicit, expanded, busy, error, onchange, onreset, onexpand, oncopy }: {
    setting: SettingPresentation;
    definition: SettingDefinition;
    value: string | boolean;
    explicit: boolean;
    expanded: boolean;
    busy: boolean;
    error?: string;
    onchange: (value: string | boolean) => void;
    onreset: () => void;
    onexpand: (expanded: boolean) => void;
    oncopy: () => void;
  } = $props();

  let editor = $state<HTMLTextAreaElement>();
  let copied = $state(false);
  const structured = $derived(definition.type === "array" || definition.type === "object");
  const fieldId = $derived(`setting-${setting.key}`);
  const descriptionId = $derived(`description-${setting.key}`);
  const detailId = $derived(`details-${setting.key}`);
  const scale = $derived(setting.scale ?? 1);

  async function editStructure(): Promise<void> {
    onexpand(true);
    await tick();
    editor?.focus();
  }
</script>

<div class="setting" data-setting-key={setting.key}>
  <div class="setting-main">
    <div class="setting-copy">
      <div class="setting-heading">
        {#if setting.unavailable}<span class="setting-label">{setting.label}</span>{:else}<label for={fieldId}>{setting.label}</label>{/if}
        {#if explicit}<span class="customized" title="Customized" aria-label="Customized"></span>{/if}
        <span class="details-control">
          <button type="button" class="details-toggle" aria-label={`Details for ${setting.label}`} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
            aria-describedby={`key-hint-${setting.key}`} onclick={() => { copied = false; onexpand(!expanded); }}>&lt;/&gt;</button>
          <span class="key-hint" id={`key-hint-${setting.key}`} role="tooltip"><code>{setting.key}</code></span>
        </span>
      </div>
      <p id={descriptionId}>{setting.description}</p>
      {#if setting.effect}<span class="effect"><span class="codicon codicon-clock" aria-hidden="true"></span>{setting.effect}</span>{/if}
    </div>
    <div class="control">
      {#if setting.unavailable}
        <span class="unavailable">Unavailable in Desktop</span>
      {:else if definition.enum}
        <select id={fieldId} aria-describedby={descriptionId} aria-invalid={Boolean(error)} disabled={busy} value={String(value)} onchange={(event) => onchange(event.currentTarget.value)}>
          {#if !definition.enum.includes(String(value))}<option value={String(value)} disabled>Unavailable value — choose an option</option>{/if}
          {#each definition.enum as option (option)}
            <option value={option} disabled={setting.disabledOptions?.includes(option)}>{setting.enumLabels?.[option] ?? option}{setting.disabledOptions?.includes(option) ? " (unavailable in Desktop)" : ""}</option>
          {/each}
        </select>
      {:else if definition.type === "boolean"}
        <input id={fieldId} class="switch" type="checkbox" aria-describedby={descriptionId} disabled={busy} checked={value === true} onchange={(event) => onchange(event.currentTarget.checked)} />
      {:else if definition.type === "number"}
        <input id={fieldId} type="number" aria-describedby={descriptionId} aria-invalid={Boolean(error)} disabled={busy} min={definition.minimum === undefined ? undefined : definition.minimum / scale}
          max={definition.maximum === undefined ? undefined : definition.maximum / scale} step="any" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} />
        {#if setting.unit}<span class="unit">{setting.unit}</span>{/if}
      {:else if structured}
        <button type="button" id={expanded ? undefined : fieldId} class="edit-structure" disabled={busy} onclick={editStructure}>{definition.type === "array" ? "Edit arguments…" : "Edit overrides…"}</button>
      {:else}
        <input id={fieldId} type="text" aria-describedby={descriptionId} aria-invalid={Boolean(error)} disabled={busy} autocomplete="off" spellcheck="false" placeholder={setting.placeholder} value={String(value)} oninput={(event) => onchange(event.currentTarget.value)} />
      {/if}
      <button type="button" class="reset" title="Reset to default" aria-label={`Reset ${setting.label}`} disabled={busy || !explicit} onclick={onreset}>
        <span class="codicon codicon-discard" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  {#if error}<p class="field-error" role="alert">{error}</p>{/if}
  {#if expanded}
    <div class="technical" id={detailId}>
      <div class="technical-heading"><code>{setting.key}</code><button type="button" class="copy-key" onclick={() => { oncopy(); copied = true; }}>{copied ? "Copied" : "Copy key"}</button></div>
      <p>{setting.key.startsWith("desktop.") ? "Desktop-only preference" : "Original extension / VS Code key"} · Default: <span class="default-value">{formatSettingValue(setting, definition, definition.default)}</span></p>
      <p>{definition.description}</p>
      {#if structured}
        <p>{definition.type === "object" ? "Edit overrides only. Omitted patterns retain built-in defaults; false re-includes a pattern." : "Enter a JSON array with one item per argument. An empty array adds no arguments."}</p>
        <textarea bind:this={editor} id={fieldId} aria-label={`${setting.label} JSON`} aria-describedby={descriptionId} aria-invalid={Boolean(error)} disabled={busy} rows="4" spellcheck="false" value={String(value)} oninput={(event) => onchange(event.currentTarget.value)}></textarea>
      {/if}
    </div>
  {/if}
</div>

<style>
  .setting { padding: 15px 18px; min-width: 0; border-bottom: 1px solid var(--frost-border); }
  .setting:last-child { border-bottom: 0; }
  .setting-main { display: grid; grid-template-columns: minmax(0, 1fr) 240px; align-items: start; gap: 18px; }
  .setting-copy { min-width: 0; }
  .setting-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
  label, .setting-label { font-size: var(--font-size-ui); font-weight: 550; overflow-wrap: anywhere; }
  label { cursor: pointer; }
  p { color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 1.5px); line-height: 1.55; margin: 5px 0 0; overflow-wrap: anywhere; }
  .customized { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--frost-warning); }
  .details-control { position: relative; display: inline-flex; }
  button { color: var(--frost-text); font: inherit; cursor: pointer; border-radius: 4px; }
  button:disabled { cursor: default; opacity: .5; }
  .details-toggle { min-height: 22px; padding: 0 4px; background: transparent; color: var(--frost-muted); font: var(--font-size-detail) var(--font-mono); }
  .details-toggle:hover, .details-toggle[aria-expanded="true"] { color: var(--frost-link); background: var(--frost-hover); }
  .key-hint { display: none; position: absolute; bottom: calc(100% + 6px); left: -6px; z-index: 2; width: max-content; max-width: min(400px, 65vw); padding: 6px 9px; border: 1px solid var(--frost-border); border-radius: 4px; background: var(--frost-surface-raised); box-shadow: var(--frost-shadow); pointer-events: none; overflow-wrap: anywhere; }
  .details-control:hover .key-hint, .details-control:focus-within .key-hint { display: block; }
  code { font: var(--font-size-detail)/1.5 var(--font-mono); overflow-wrap: anywhere; }
  .effect { display: inline-flex; align-items: center; gap: 4px; margin-top: 7px; padding: 1px 6px; border: 1px solid var(--frost-border); border-radius: 3px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 3px); }
  .effect .codicon { font-size: 10px; }
  .control { display: flex; align-items: center; justify-content: flex-end; gap: 7px; min-width: 0; min-height: 32px; }
  input:not([type="checkbox"]), select, textarea { box-sizing: border-box; min-width: 0; width: 100%; padding: 7px 9px; border: 1px solid var(--frost-input-border); border-radius: 4px; background: var(--frost-input-bg); color: var(--frost-text); font: inherit; }
  input[type="number"] { width: 78px; }
  .unit { min-width: 20px; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .switch { appearance: none; flex: none; position: relative; width: 31px; height: 18px; margin: 5px 0; border-radius: 20px; background: var(--frost-muted); cursor: pointer; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
  .switch:checked { background: var(--frost-accent); }
  .switch:checked::after { left: 16px; }
  .reset { flex: none; padding: 4px; background: transparent; color: var(--frost-muted); }
  .reset:disabled { visibility: hidden; }
  .reset:hover { color: var(--frost-text); background: var(--frost-hover); }
  .edit-structure, .copy-key { padding: 5px 9px; border: 1px solid var(--frost-border); background: var(--frost-secondary-bg); }
  .edit-structure:hover, .copy-key:hover { background: var(--frost-secondary-hover); }
  .unavailable { font-size: var(--font-size-detail); color: var(--frost-muted); }
  .technical { padding: 11px 12px; margin-top: 11px; border: 1px solid var(--frost-border); border-radius: 5px; background: var(--frost-bg-alt); }
  .technical-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .technical-heading code { user-select: text; }
  .copy-key { flex: none; font-size: calc(var(--font-size-ui) - 3px); }
  .default-value { overflow-wrap: anywhere; }
  textarea { margin-top: 10px; font: var(--font-size-detail)/1.6 var(--font-mono); resize: vertical; }
  .field-error { color: var(--frost-error); }
  :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  [aria-invalid="true"] { border-color: var(--frost-error); }
  @media (max-width: 720px) {
    .setting { padding: 14px; }
    .setting-main { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .control { justify-content: flex-start; }
    .reset { margin-left: auto; }
    .technical { padding: 9px; }
  }
</style>
