import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DesktopSettingsController } from "../src/main/settings/DesktopSettingsController.js";
import { DesktopSettingsError, settingsErrorMessage } from "../src/main/settings/DesktopSettingsError.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "frostpi-settings-actions-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const store = await DesktopSettingsStore.open(join(directory, "settings.json"));
  const actions = {
    importDefaults: vi.fn(() => Promise.resolve({ values: { "chat.fontSize": 18 }, notices: ["Import preview"] })),
    openFile: vi.fn<(path: string) => Promise<void>>(() => Promise.resolve()),
  };
  return { store, actions, controller: new DesktopSettingsController(store, actions) };
}

describe("Desktop settings actions", () => {
  it("forwards only deliberately authored business errors, not unexpected exception contents", () => {
    expect(settingsErrorMessage(new DesktopSettingsError("Invalid value for chat.fontSize.")))
      .toBe("Invalid value for chat.fontSize.");
    const message = settingsErrorMessage(new Error("http://user:secret@localhost:7890"));
    expect(message).toBe("The Desktop settings operation failed. Check the settings file and try again.");
    expect(settingsErrorMessage({ message: "secret" })).toBe(message);
  });

  it("previews the one-time import, commits only on Save, and keeps imported keys unchanged", async () => {
    const { controller, store, actions } = await fixture();
    expect((await controller.handle({ type: "importVscode" })).values).toEqual({ "chat.fontSize": 18 });
    expect(store.firstRun).toBe(true);
    expect(store.values).toEqual({});
    await controller.handle({ type: "save", values: { "chat.fontSize": 18 } });
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual({ "chat.fontSize": 18 });
    await expect(controller.handle({ type: "importVscode" })).rejects.toThrow("only available before");
    expect(actions.importDefaults).toHaveBeenCalledTimes(1);
  });

  it("initializes defaults without importing, and does not let the first-run action reset existing settings", async () => {
    const { controller, store, actions } = await fixture();
    await controller.handle({ type: "useDefaults" });
    expect(store.firstRun).toBe(false);
    expect(store.values).toEqual({});
    expect(actions.importDefaults).not.toHaveBeenCalled();
    await controller.handle({ type: "save", values: { "chat.fontSize": 20 } });
    await expect(controller.handle({ type: "useDefaults" })).rejects.toThrow("already been initialized");
    expect(store.values).toEqual({ "chat.fontSize": 20 });
  });

  it("rejects invalid writes and actions, and opens only its own fixed settings path", async () => {
    const { controller, store, actions } = await fixture();
    await controller.handle({ type: "useDefaults" });
    await expect(controller.handle({ type: "save", values: { "chat.fontSize": "bad-value" } })).rejects.toThrow("chat.fontSize");
    await expect(controller.handle({ type: "save", values: { "desktop.unknownSetting": true } })).rejects.toThrow("supported setting keys");
    await expect(controller.handle({ type: "readFile", path: "not-authorized" })).rejects.toThrow("Invalid settings action");
    await controller.handle({ type: "openFile", path: "not-authorized" });
    expect(actions.openFile).toHaveBeenCalledWith(store.filePath);
    expect(store.values).toEqual({});
  });

  it("persists theme changes without replacing other settings and rejects unsupported themes", async () => {
    const { controller, store } = await fixture();
    await expect(controller.handle({ type: "setTheme", theme: "light" })).rejects.toThrow("Use defaults");
    expect(store.firstRun).toBe(true);
    await controller.handle({ type: "save", values: { "chat.fontSize": 18 } });
    await Promise.all([
      store.update("chat.editor.fontSize", 19),
      controller.handle({ type: "setTheme", theme: "light" }),
    ]);
    expect((await DesktopSettingsStore.open(store.filePath)).values).toEqual({
      "chat.fontSize": 18, "chat.editor.fontSize": 19, "desktop.theme": "light",
    });
    await expect(controller.handle({ type: "setTheme", theme: "arbitrary-file.json" })).rejects.toThrow("desktop.theme");
    await expect(controller.handle({ type: "setTheme" })).rejects.toThrow("desktop.theme");
    expect(store.values["desktop.theme"]).toBe("light");
    expect((await controller.handle({ type: "setTheme", theme: "dark" })).values["desktop.theme"]).toBe("dark");
  });

  it("reports a damaged file without permitting import/reset/Save over it, then reloads a repair", async () => {
    const { controller, store, actions } = await fixture();
    await writeFile(store.filePath, "{ broken }");
    expect((await controller.handle({ type: "reload" })).error).toContain("Cannot read");
    await expect(controller.handle({ type: "save", values: {} })).rejects.toThrow("reload");
    await expect(controller.handle({ type: "setTheme", theme: "light" })).rejects.toThrow("reload");
    await expect(controller.handle({ type: "importVscode" })).rejects.toThrow("only available before");
    await expect(controller.handle({ type: "useDefaults" })).rejects.toThrow("already been initialized");
    expect(actions.importDefaults).not.toHaveBeenCalled();
    expect(await readFile(store.filePath, "utf8")).toBe("{ broken }");
    await writeFile(store.filePath, '{"chat.editor.fontSize":18}');
    expect((await controller.handle({ type: "reload" })).values).toEqual({ "chat.editor.fontSize": 18 });
    expect(store.error).toBeUndefined();
  });
});
