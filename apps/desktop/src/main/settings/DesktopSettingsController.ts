import type { DesktopSettingsAction, DesktopSettingsView } from "../../shared/desktopSettings.js";
import type { DesktopSettingsStore } from "./DesktopSettingsStore.js";
import { DesktopSettingsError } from "./DesktopSettingsError.js";
import { isSettingValueValid } from "./validateDesktopSettings.js";

interface SettingsActions {
  importDefaults(): Promise<{ values: Record<string, unknown>; notices: string[] }>;
  openFile(filePath: string): Promise<void>;
}

/** Renderer actions never choose a settings/import path or receive filesystem access. */
export class DesktopSettingsController {
  constructor(private readonly store: DesktopSettingsStore, private readonly actions: SettingsActions) {}

  view(): DesktopSettingsView {
    return {
      values: this.store.values,
      filePath: this.store.filePath,
      firstRun: this.store.firstRun,
      notices: [],
      ...(this.store.error ? { error: this.store.error } : {}),
    };
  }

  async handle(raw: unknown): Promise<DesktopSettingsView> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DesktopSettingsError("Invalid settings action.");
    const action = raw as DesktopSettingsAction;
    switch (action.type) {
      case "read": return this.view();
      case "save":
        await this.store.replace(action.values);
        return { ...this.view(), notices: ["Settings saved. Running Pi processes were not restarted."] };
      case "setTheme":
        if (this.store.firstRun) throw new DesktopSettingsError("Save settings or choose Use defaults before changing the Desktop theme.");
        if (!isSettingValueValid("desktop.theme", action.theme)) throw new DesktopSettingsError("Invalid value for desktop.theme.");
        await this.store.update("desktop.theme", action.theme);
        return this.view();
      case "importVscode": {
        if (!this.store.firstRun || this.store.error) throw new DesktopSettingsError("VS Code import is only available before Desktop settings have been initialized.");
        const imported = await this.actions.importDefaults();
        return { ...this.view(), values: imported.values, notices: imported.notices };
      }
      case "useDefaults":
        if (!this.store.firstRun || this.store.error) throw new DesktopSettingsError("Desktop settings have already been initialized. Reset individual settings instead.");
        await this.store.replace({});
        return this.view();
      case "openFile":
        if (this.store.firstRun) throw new DesktopSettingsError("Save settings or choose Use defaults before opening settings.json.");
        await this.actions.openFile(this.store.filePath);
        return this.view();
      case "reload":
        await this.store.reload();
        return this.view();
      default: throw new DesktopSettingsError("Invalid settings action.");
    }
  }
}
