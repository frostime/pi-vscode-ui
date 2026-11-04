import { describe, expect, it } from "vitest";
import { isDesktopUpdateNativeView, parseDesktopUpdateAction } from "../src/shared/desktopUpdates.js";

describe("Desktop update protocol", () => {
  it("accepts only the four finite actions and no extra fields", () => {
    for (const type of ["read", "check", "download", "install"]) expect(parseDesktopUpdateAction({ type })).toEqual({ type });
    for (const forged of [
      { type: "check", url: "https://example.invalid/update.json" },
      { type: "download", path: "C:\\Temp\\update.msi" },
      { type: "install", path: "C:\\Temp\\update.msi" },
      { type: "apply" }, {}, "check", null, ["check"],
    ]) expect(parseDesktopUpdateAction(forged)).toBeUndefined();
  });

  it("accepts native update states and rejects fields the protocol does not define", () => {
    const idle = { currentVersion: "0.16.2", configured: false, checked: false, operation: "idle" };
    expect(isDesktopUpdateNativeView(idle)).toBe(true);
    expect(isDesktopUpdateNativeView({ ...idle, checked: true })).toBe(true);
    expect(isDesktopUpdateNativeView({ ...idle, available: { version: "0.17.0", notes: "Release notes" } })).toBe(true);
    expect(isDesktopUpdateNativeView({ currentVersion: "0.16.2", configured: true, checked: true, operation: "downloading", downloaded: { version: "0.17.0" }, progress: { receivedBytes: 1, totalBytes: 2 } })).toBe(true);
    expect(isDesktopUpdateNativeView({ ...idle, error: "Download failed." })).toBe(true);
    for (const forged of [
      { currentVersion: "0.16.2", configured: true, operation: "idle" },
      { ...idle, checked: "yes" },
      { ...idle, installBlock: { reason: "opening" } },
      { ...idle, downloadUrl: "https://example.invalid/update.json" },
      { ...idle, operation: "installing" },
      { ...idle, currentVersion: 16 },
      { ...idle, progress: { receivedBytes: -1 } },
      { ...idle, available: { version: "0.17.0", url: "https://example.invalid/update.json" } },
    ]) expect(isDesktopUpdateNativeView(forged)).toBe(false);
  });
});
