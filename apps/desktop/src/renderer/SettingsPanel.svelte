<script lang="ts">
  import { desktopSettingDefinitions, type DesktopSettingsAction, type DesktopSettingsTarget, type DesktopSettingsView, type SettingDefinition } from "../shared/desktopSettings.js";

  let { view, target = "all", busy, error, onaction, onclose }: {
    view: DesktopSettingsView;
    target?: DesktopSettingsTarget;
    busy: boolean;
    error?: string;
    onaction: (action: DesktopSettingsAction) => Promise<void>;
    onclose: () => void;
  } = $props();

  let panel = $state<HTMLDialogElement>();
  let focusedTarget: DesktopSettingsTarget | undefined;
  $effect(() => {
    const element = panel;
    const requested = target;
    if (!element || busy || requested === "all" || focusedTarget === requested) return;
    queueMicrotask(() => {
      if (!element.isConnected) return;
      const field = element.ownerDocument.getElementById(`setting-${requested}`);
      field?.focus();
      field?.scrollIntoView({ block: "center" });
      focusedTarget = requested;
    });
  });

  const proxyModeKey = "frostpi.network.proxy.mode";
  const notificationsKey = "frostpi.notifications.experimental.enabled";
  const sections = [
    { title: "Typography", expanded: true, keys: Object.keys(desktopSettingDefinitions).filter((key) => key.startsWith("chat.") || key === "editor.fontFamily") },
    { title: "Pi", expanded: true, keys: Object.keys(desktopSettingDefinitions).filter((key) => key.startsWith("frostpi.pi.")) },
    { title: "Proxy", expanded: true, keys: Object.keys(desktopSettingDefinitions).filter((key) => key.startsWith("frostpi.network.proxy.")) },
    { title: "Other settings", expanded: false, keys: Object.keys(desktopSettingDefinitions).filter((key) => !key.startsWith("chat.") && key !== "editor.fontFamily" && !key.startsWith("frostpi.pi.") && !key.startsWith("frostpi.network.proxy.")) },
  ];

  // Only explicit overrides live in the draft. Structured fields hold editable JSON until Save.
  let draft = $state<Record<string, unknown>>({});
  let validationErrors = $state<string[]>([]);

  $effect(() => {
    const nextDraft = { ...view.values };
    for (const [key, definition] of Object.entries(desktopSettingDefinitions)) {
      if (Object.hasOwn(nextDraft, key) && (definition.type === "array" || definition.type === "object")) {
        nextDraft[key] = JSON.stringify(nextDraft[key], null, 2);
      }
    }
    draft = nextDraft;
    validationErrors = [];
  });

  function isExplicit(key: string): boolean {
    return Object.hasOwn(draft, key);
  }

  function fieldValue(key: string, definition: SettingDefinition): unknown {
    if (isExplicit(key)) return draft[key];
    return definition.type === "array" || definition.type === "object"
      ? JSON.stringify(definition.default, null, 2)
      : definition.default;
  }

  function updateField(key: string, value: unknown): void {
    draft[key] = value;
    validationErrors = [];
  }

  function resetField(key: string): void {
    delete draft[key];
    validationErrors = [];
  }

  async function act(action: DesktopSettingsAction): Promise<void> {
    if (busy) return;
    await onaction(action);
  }

  async function save(): Promise<void> {
    if (busy || view.error) return;
    const values = { ...draft };
    const errors: string[] = [];
    for (const [key, definition] of Object.entries(desktopSettingDefinitions)) {
      if (!Object.hasOwn(values, key)) continue;
      if (definition.type === "array" || definition.type === "object") {
        try {
          const parsed: unknown = JSON.parse(String(draft[key]));
          if (definition.type === "array" ? !Array.isArray(parsed) : parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Invalid structure");
          }
          values[key] = parsed;
        } catch {
          errors.push(`${key}: enter valid JSON with the required ${definition.type} structure.`);
        }
      } else if (definition.type === "number") {
        const value = Number(draft[key]);
        if (String(draft[key]).trim() === "" || !Number.isFinite(value)
          || (definition.minimum !== undefined && value < definition.minimum)
          || (definition.maximum !== undefined && value > definition.maximum)) {
          errors.push(`${key}: enter a number within the displayed limits.`);
        } else {
          values[key] = value;
        }
      }
      if (definition.enum && !definition.enum.includes(String(values[key]))) {
        errors.push(`${key}: choose a listed option.`);
      }
    }
    if (values[proxyModeKey] === "vscode") errors.push(`${proxyModeKey}: VS Code mode is unavailable in Desktop. Choose another mode or Reset.`);
    if (values[notificationsKey] === true) errors.push(`${notificationsKey}: notifications are unavailable in Desktop. Use Reset.`);
    validationErrors = errors;
    if (errors.length === 0) await act({ type: "save", values });
  }

  function openDialog(element: HTMLDialogElement): { destroy(): void } {
    element.showModal();
    return { destroy: () => element.close() };
  }
</script>

<dialog bind:this={panel} use:openDialog aria-labelledby="settings-title" oncancel={(event) => { event.preventDefault(); if (!busy) onclose(); }}>
  <header>
    <h2 id="settings-title">Desktop settings</h2>
    <button type="button" disabled={busy} onclick={onclose}>Close</button>
  </header>
  <form novalidate onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <div class="settings-body">
      <p class="file-path"><strong>settings.json</strong><br />{view.filePath}</p>
      <p>Desktop settings are maintained independently. Importing never writes to or synchronizes with VS Code.</p>
      {#if view.firstRun}
        <section class="notice" aria-labelledby="first-run-title">
          <h3 id="first-run-title">Set up Desktop settings</h3>
          <p>Import once from the default VS Code user configuration, or use defaults. Import creates an editable preview only; choose Save to persist it.</p>
          <div class="actions">
            <button type="button" disabled={busy} onclick={() => act({ type: "importVscode" })}>Import VS Code defaults</button>
            <button type="button" disabled={busy} onclick={() => act({ type: "useDefaults" })}>Use defaults</button>
          </div>
        </section>
      {/if}
      {#each view.notices as notice (notice)}
        <p class="notice">{notice}</p>
      {/each}
      {#if view.error}
        <div class="error" role="alert">
          <p>{view.error}</p>
          <p>Save is disabled to avoid overwriting a damaged file. Open settings.json, repair it, then choose Reload.</p>
        </div>
      {/if}
      <div aria-live="polite">
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if validationErrors.length}
          <ul class="error" role="alert">{#each validationErrors as message (message)}<li>{message}</li>{/each}</ul>
        {/if}
        {#if busy}<p role="status">Updating settings…</p>{/if}
      </div>
      <p>Reset removes an explicit setting and restores its default. Empty strings remain explicit settings.</p>
      {#each sections as section (section.title)}
        <details open={section.expanded}>
          <summary>{section.title}</summary>
          {#if section.title === "Proxy"}
            <p>Proxy credentials are not supported. The endpoint must not contain an account or password. VS Code proxy mode is unavailable in Desktop.</p>
          {/if}
          {#each section.keys as key (key)}
            {@const definition = desktopSettingDefinitions[key]!}
            {@const value = fieldValue(key, definition)}
            <div class="setting">
              <div class="setting-heading">
                <label for={`setting-${key}`}>{key}</label>
                <span class="setting-state">{isExplicit(key) ? "Explicit" : "Default"}</span>
                <button type="button" aria-label={`Reset ${key}`} disabled={busy || !isExplicit(key)} onclick={() => resetField(key)}>Reset</button>
              </div>
              <p id={`description-${key}`}>{definition.description}</p>
              {#if key === notificationsKey}<p>Unavailable in Desktop. Reset any enabled imported override before saving.</p>{/if}
              {#if definition.enum}
                <select id={`setting-${key}`} aria-describedby={`description-${key}`} disabled={busy} value={String(value)} onchange={(event) => updateField(key, event.currentTarget.value)}>
                  {#if !definition.enum.includes(String(value))}<option value={String(value)} disabled>Unavailable value — choose an option</option>{/if}
                  {#each definition.enum as option (option)}
                    <option value={option} disabled={key === proxyModeKey && option === "vscode"}>{option}{key === proxyModeKey && option === "vscode" ? " (unavailable in Desktop)" : ""}</option>
                  {/each}
                </select>
              {:else if definition.type === "boolean"}
                <input id={`setting-${key}`} type="checkbox" aria-describedby={`description-${key}`} disabled={busy || key === notificationsKey} checked={value === true} onchange={(event) => updateField(key, event.currentTarget.checked)} />
              {:else if definition.type === "number"}
                <input id={`setting-${key}`} type="number" aria-describedby={`description-${key}`} disabled={busy} min={definition.minimum} max={definition.maximum} step="any" value={String(value)} oninput={(event) => updateField(key, event.currentTarget.value)} />
                {#if definition.minimum !== undefined || definition.maximum !== undefined}
                  <small>Minimum: {definition.minimum ?? "none"}; maximum: {definition.maximum ?? "none"}.</small>
                {/if}
              {:else if definition.type === "array" || definition.type === "object"}
                <textarea id={`setting-${key}`} aria-describedby={`description-${key}`} aria-label={`${key} (JSON ${definition.type})`} disabled={busy} rows="4" spellcheck="false" value={String(value)} oninput={(event) => updateField(key, event.currentTarget.value)}></textarea>
              {:else}
                <input id={`setting-${key}`} type="text" aria-describedby={`description-${key}`} disabled={busy} autocomplete="off" spellcheck="false" value={String(value)} oninput={(event) => updateField(key, event.currentTarget.value)} />
              {/if}
            </div>
          {/each}
        </details>
      {/each}
      <p>After Save, fonts, exclusion rules, and other application settings refresh. Executable, proxy, and other process settings take effect only for a new Pi process or an explicit restart. Saving does not restart Pi.</p>
    </div>
    <footer>
      <button type="button" disabled={busy || view.firstRun} onclick={() => act({ type: "openFile" })}>Open settings.json</button>
      <button type="button" disabled={busy} onclick={() => act({ type: "reload" })}>Reload</button>
      <button type="submit" class="save" disabled={busy || Boolean(view.error)}>Save</button>
    </footer>
  </form>
</dialog>

<style>
  dialog { box-sizing: border-box; margin: auto; padding: 0; width: min(760px, calc(100vw - 20px)); max-height: calc(100dvh - 20px); border: 1px solid var(--frost-border); border-radius: 6px; background: var(--frost-surface-raised); color: var(--frost-text); font: var(--font-size) var(--font-ui); overflow: hidden; }
  dialog::backdrop { background: #0008; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--frost-border); }
  h2 { margin: 0; font-size: 1.15em; }
  h3 { margin: 0 0 8px; font-size: 1em; }
  form { display: flex; flex-direction: column; min-height: 0; max-height: calc(100dvh - 85px); }
  .settings-body { padding: 12px; overflow: auto; min-height: 0; overscroll-behavior: contain; }
  p { margin: 0 0 10px; line-height: 1.5; overflow-wrap: anywhere; }
  .file-path { user-select: text; }
  .notice { padding: 10px; border: 1px solid var(--frost-border); margin-bottom: 12px; }
  .error { color: var(--frost-error); overflow-wrap: anywhere; }
  .actions, footer { display: flex; flex-wrap: wrap; gap: 8px; }
  footer { flex-shrink: 0; padding: 12px; border-top: 1px solid var(--frost-border); }
  button { max-width: 100%; padding: 6px 10px; border: 1px solid var(--frost-border); border-radius: 3px; background: var(--frost-secondary-bg); color: var(--frost-text); font: inherit; white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--frost-hover); }
  button:disabled { opacity: 0.6; cursor: default; }
  :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  details { margin: 12px 0; border-top: 1px solid var(--frost-border); }
  summary { padding: 10px 0; cursor: pointer; font-weight: 600; }
  .setting { margin-bottom: 16px; min-width: 0; }
  .setting-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 5px; }
  label { flex: 1 1 100%; overflow-wrap: anywhere; font-family: var(--font-mono); }
  .setting-state, .setting p, small { color: var(--frost-muted); }
  .setting-state, small { font-size: 0.9em; }
  .setting p { margin-bottom: 6px; }
  input:not([type="checkbox"]), select, textarea { box-sizing: border-box; display: block; width: 100%; min-width: 0; max-width: 100%; padding: 7px; border: 1px solid var(--frost-input-border); border-radius: 2px; background: var(--frost-input-bg); color: var(--frost-text); font: inherit; }
  textarea { resize: vertical; font-family: var(--font-mono); }
  input[type="checkbox"] { margin: 4px 0; }
  small { display: block; margin-top: 4px; }
  @media (min-width: 500px) { label { flex-basis: auto; } .save { margin-left: auto; } }
</style>
