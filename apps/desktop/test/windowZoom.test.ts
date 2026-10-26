import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindowZoom } from "../src/main/windowZoom.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "frostpi-zoom-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function windowBoundary() {
  let factor = 1;
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setZoomMode: vi.fn(),
    getZoomFactor: () => factor,
    setZoomFactor: (value: number) => { factor = value; },
  });
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const key = (value: string, extra: Partial<Electron.Input> = {}) => {
    const event = { preventDefault: vi.fn() };
    contents.emit("before-input-event", event, {
      type: "keyDown", key: value, code: "", alt: false, isComposing: false,
      control: process.platform !== "darwin", meta: process.platform === "darwin", ...extra,
    });
    return event;
  };
  return { window, contents, key };
}

describe("Desktop window zoom", () => {
  it("applies saved values, counts rapid shortcuts in order, and drains them before disposal", async () => {
    const file = join(root, "settings.json");
    const store = await DesktopSettingsStore.open(file);
    await store.replace({ "desktop.zoomFactor": 1.25, "desktop.theme": "light" });
    const boundary = windowBoundary();
    const reportError = vi.fn();
    const dispose = installWindowZoom(boundary.window, store, reportError);
    expect(boundary.contents.getZoomFactor()).toBe(1.25);
    await store.update("desktop.zoomFactor", 1.3);
    expect(boundary.contents.getZoomFactor()).toBe(1.3);
    boundary.contents.setZoomFactor(1);
    boundary.contents.emit("did-finish-load");
    expect(boundary.contents.getZoomFactor()).toBe(1.3);
    expect(boundary.key("+").preventDefault).toHaveBeenCalled();
    boundary.key("=");
    boundary.key("-");
    await dispose();
    expect(boundary.contents.getZoomFactor()).toBe(1.4);
    expect((await DesktopSettingsStore.open(file)).values).toEqual({ "desktop.zoomFactor": 1.4, "desktop.theme": "light" });
    expect(boundary.contents.listenerCount("before-input-event")).toBe(0);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("respects limits, handles wheel zoom, and Reset removes rather than pins the default", async () => {
    const store = await DesktopSettingsStore.open(join(root, "settings.json"));
    await store.replace({ "desktop.zoomFactor": 2 });
    const boundary = windowBoundary();
    const dispose = installWindowZoom(boundary.window, store, () => { throw new Error("Unexpected save failure"); });
    boundary.key("+");
    boundary.key("0");
    await dispose();
    expect(boundary.contents.getZoomFactor()).toBe(1);
    expect(store.values).toEqual({});
    await store.update("desktop.zoomFactor", 0.5);
    const disposeAgain = installWindowZoom(boundary.window, store, () => { throw new Error("Unexpected save failure"); });
    boundary.key("-");
    boundary.contents.emit("zoom-changed", {}, "in");
    await disposeAgain();
    expect(store.values["desktop.zoomFactor"]).toBe(0.6);
  });

  it("leaves ordinary typing, AltGr, composition and key-up events alone", async () => {
    const store = await DesktopSettingsStore.open(join(root, "settings.json"));
    await store.replace({});
    const boundary = windowBoundary();
    const dispose = installWindowZoom(boundary.window, store, vi.fn());
    expect(boundary.key("=", { control: false, meta: false }).preventDefault).not.toHaveBeenCalled();
    expect(boundary.key("=", { alt: true }).preventDefault).not.toHaveBeenCalled();
    expect(boundary.key("=", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
    expect(boundary.key("=", { type: "keyUp" }).preventDefault).not.toHaveBeenCalled();
    expect(boundary.key("x").preventDefault).not.toHaveBeenCalled();
    await dispose();
    expect(store.values).toEqual({});
  });

  it("cannot consume first-run import or write over damaged settings", async () => {
    const file = join(root, "settings.json");
    const store = await DesktopSettingsStore.open(file);
    const boundary = windowBoundary();
    const dispose = installWindowZoom(boundary.window, store, vi.fn());
    boundary.key("+");
    await dispose();
    expect(store.firstRun).toBe(true);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(file, "{ broken");
    await store.reload();
    const disposeAgain = installWindowZoom(boundary.window, store, vi.fn());
    boundary.key("+");
    await disposeAgain();
    expect(store.error).toBeTruthy();
    expect(await readFile(file, "utf8")).toBe("{ broken");
  });

  it("reports failed persistence without pretending native zoom changed", async () => {
    const file = join(root, "settings.json");
    const store = await DesktopSettingsStore.open(file);
    await store.replace({});
    await rm(file);
    await mkdir(file);
    const boundary = windowBoundary();
    const reportError = vi.fn();
    const dispose = installWindowZoom(boundary.window, store, reportError);
    boundary.key("+");
    await dispose();
    expect(reportError).toHaveBeenCalledOnce();
    expect(store.values).toEqual({});
    expect(boundary.contents.getZoomFactor()).toBe(1);
  });
});
