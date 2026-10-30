import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";

let root: string;
let file: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frostpi-settings-test-"));
  file = join(root, "settings.json");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("DesktopSettingsStore", () => {
  it("keeps first run read-only, saves dot keys and reopens without exposing mutable state", async () => {
    const store = await DesktopSettingsStore.open(file);
    expect(store.firstRun).toBe(true);
    expect(store.error).toBeUndefined();
    expect(store.values).toEqual({});
    expect(await readdir(root)).toEqual([]);
    const values = { "chat.fontSize": 17, "files.exclude": { "**/build": true } };
    const save = store.replace(values);
    values["files.exclude"]["**/build"] = false;
    await save;
    expect(store.firstRun).toBe(false);
    const exposed = store.values;
    (exposed["files.exclude"] as Record<string, boolean>)["**/build"] = false;
    const reopened = await DesktopSettingsStore.open(file);
    expect(reopened.firstRun).toBe(false);
    expect(store.values).toEqual(reopened.values);
    expect(reopened.values).toEqual({ "chat.fontSize": 17, "files.exclude": { "**/build": true } });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(reopened.values);
  });

  it("serializes different-key updates and deletion, and publishes only committed values", async () => {
    const store = await DesktopSettingsStore.open(file);
    const observed: unknown[] = [];
    const stop = store.onDidChange(() => { observed.push(store.values); });
    await Promise.all([store.update("chat.fontSize", 18), store.update("chat.editor.fontSize", 19)]);
    expect(store.values).toEqual({ "chat.fontSize": 18, "chat.editor.fontSize": 19 });
    await store.update("chat.fontSize", undefined);
    expect(store.values).toEqual({ "chat.editor.fontSize": 19 });
    expect(observed).toEqual([
      { "chat.fontSize": 18 },
      { "chat.fontSize": 18, "chat.editor.fontSize": 19 },
      { "chat.editor.fontSize": 19 },
    ]);
    stop();
    await store.replace({});
    expect(observed).toHaveLength(3);
    expect((await DesktopSettingsStore.open(file)).values).toEqual({});
  });

  it.each([
    '{"chat.fontSize": 18, broken secret}',
    '["secret"]',
    '{"chat.fontSize": "secret"}',
    '{"frostpi.network.proxy.endpoint": "http://user:secret@localhost:1234"}',
    " ".repeat(1024 * 1024 + 1),
  ])("blocks damaged settings without overwriting, then recovers through reload (%#)", async (text) => {
    await writeFile(file, text);
    const store = await DesktopSettingsStore.open(file);
    expect(store.firstRun).toBe(false);
    expect(store.values).toEqual({});
    expect(store.error).toContain("reload");
    expect(store.error).not.toContain("secret");
    await expect(store.replace({})).rejects.toThrow("reload");
    await expect(store.update("chat.fontSize", 20)).rejects.toThrow("reload");
    expect(await readFile(file, "utf8")).toBe(text);
    await writeFile(file, '{ // repaired\n "chat.fontSize": 20, }');
    await store.reload();
    expect(store.error).toBeUndefined();
    expect(store.values).toEqual({ "chat.fontSize": 20 });
    await store.update("chat.fontSize", 21);
    expect((await DesktopSettingsStore.open(file)).values).toEqual({ "chat.fontSize": 21 });
  });

  it("does not publish failed writes and can retry after the filesystem is repaired", async () => {
    const folder = join(root, "folder");
    const target = join(folder, "settings.json");
    const store = await DesktopSettingsStore.open(target);
    await store.replace({ "chat.fontSize": 16 });
    await rename(folder, join(root, "backup"));
    await writeFile(folder, "not a directory");
    let events = 0;
    store.onDidChange(() => { events++; });
    await expect(store.update("chat.fontSize", 20)).rejects.toThrow("Cannot save");
    expect(store.values).toEqual({ "chat.fontSize": 16 });
    expect(events).toBe(0);
    await rm(folder);
    await rename(join(root, "backup"), folder);
    await store.update("chat.editor.fontSize", 22);
    expect((await DesktopSettingsStore.open(target)).values).toEqual({ "chat.fontSize": 16, "chat.editor.fontSize": 22 });
    expect(await readdir(folder)).toEqual(["settings.json"]);
  });

  it("reports read failures as errors rather than first run, and rejects invalid saves safely", async () => {
    await writeFile(file, "parent is a file");
    const unreadable = await DesktopSettingsStore.open(join(file, "settings.json"));
    expect(unreadable.firstRun).toBe(false);
    expect(unreadable.error).toContain("Cannot read");
    const store = await DesktopSettingsStore.open(join(root, "valid.json"));
    await expect(store.replace({ "chat.fontSize": "secret" })).rejects.not.toThrow("secret");
    expect(store.values).toEqual({});
    expect(store.firstRun).toBe(true);
  });
});
