import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultVscodeSettingsPath, importVscodeSettings } from "../src/main/settings/importVscodeSettings.js";
import { validateDesktopSettings } from "../src/main/settings/validateDesktopSettings.js";

const MODE = "frostpi.network.proxy.mode";
const ENDPOINT = "frostpi.network.proxy.endpoint";
let root: string;
let file: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frostpi-import-test-"));
  file = join(root, "settings.json");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function preview(values: Record<string, unknown>) {
  await writeFile(file, JSON.stringify(values));
  return importVscodeSettings(file);
}

describe("VS Code default-user settings import", () => {
  it("resolves only stable default-user paths across platforms", () => {
    expect(defaultVscodeSettingsPath("win32", "C:\\Users\\Tester", "D:\\Roaming")).toBe("D:\\Roaming\\Code\\User\\settings.json");
    expect(defaultVscodeSettingsPath("win32", "C:\\Users\\Tester")).toBe("C:\\Users\\Tester\\AppData\\Roaming\\Code\\User\\settings.json");
    expect(defaultVscodeSettingsPath("darwin", "/Users/tester")).toBe("/Users/tester/Library/Application Support/Code/User/settings.json");
    expect(defaultVscodeSettingsPath("linux", "/home/tester", undefined, "/config")).toBe("/config/Code/User/settings.json");
    expect(defaultVscodeSettingsPath("linux", "/home/tester")).toBe("/home/tester/.config/Code/User/settings.json");
  });

  it("previews JSONC dot keys only, without language or Project overrides and without writing", async () => {
    const text = '{ // user settings\n "chat.fontSize": 17, "files.exclude": {"**/build": true}, "[typescript]": {"chat.fontSize": 90}, "fontSize": 80, "workbench.colorTheme": "secret", }';
    await writeFile(file, text);
    await mkdir(join(root, ".vscode"));
    await writeFile(join(root, ".vscode", "settings.json"), '{"chat.fontSize":99}');
    const result = await importVscodeSettings(file);
    expect(result).toEqual({ values: { "chat.fontSize": 17, "files.exclude": { "**/build": true } }, notices: [] });
    expect(await readFile(file, "utf8")).toBe(text);
  });

  it("skips invalid known values and unsupported notifications without disclosing input", async () => {
    const result = await preview({
      "chat.fontSize": "secret", "files.exclude": { "**/build": "secret" },
      "frostpi.notifications.experimental.enabled": true, "editor.fontFamily": "Test Mono",
      "unknown-secret": true,
    });
    expect(result.values).toEqual({ "editor.fontFamily": "Test Mono" });
    expect(result.notices).toHaveLength(3);
    expect(result.notices.join(" ")).toContain("chat.fontSize");
    expect(result.notices.join(" ")).toContain("frostpi.notifications.experimental.enabled");
    expect(result.notices.join(" ")).not.toContain("secret");
  });

  it.each(["http://localhost:8080", "socks5://localhost:1080"])("explicitly converts vscode mode using %s", async (endpoint) => {
    const result = await preview({ [MODE]: "vscode", "http.proxy": endpoint });
    expect(result.values).toEqual({ [MODE]: "custom", [ENDPOINT]: endpoint });
    expect(result.notices.join(" ")).toContain("Converted");
    expect(validateDesktopSettings(result.values)).toEqual([]);
  });

  it.each([undefined, "ftp://localhost:12", "http://user:secret@localhost:8080", 123])("preserves unresolved vscode mode and never leaks credentials (%#)", async (endpoint) => {
    const result = await preview({ [MODE]: "vscode", "http.proxy": endpoint });
    expect(result.values).toEqual({ [MODE]: "vscode" });
    expect(result.notices.join(" ")).toContain("before saving");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("user:");
    expect(validateDesktopSettings(result.values).length).toBeGreaterThan(0);
  });

  it("does not enable a proxy implicitly and removes credential-bearing custom endpoints", async () => {
    expect((await preview({ "http.proxy": "http://localhost:8080" })).values).toEqual({});
    const invalid = await preview({ [MODE]: "custom", [ENDPOINT]: "http://user:secret@localhost:8080" });
    expect(invalid.values).toEqual({ [MODE]: "custom" });
    expect(invalid.notices.join(" ")).toContain(ENDPOINT);
    expect(JSON.stringify(invalid)).not.toContain("secret");
    expect(validateDesktopSettings(invalid.values).length).toBeGreaterThan(0);
    const valid = await preview({ [MODE]: "custom", [ENDPOINT]: "http://localhost:8080" });
    expect(valid.values).toEqual({ [MODE]: "custom", [ENDPOINT]: "http://localhost:8080" });
    expect(valid.notices).toEqual([]);
    const missing = await preview({ [MODE]: "custom" });
    expect(missing.values).toEqual({ [MODE]: "custom" });
    expect(missing.notices.join(" ")).toContain(ENDPOINT);
  });

  it("migrates legacy proxy endpoints with shared-reader precedence and without credentials", async () => {
    const legacy = await preview({
      [MODE]: "custom", [ENDPOINT]: " ",
      "frostpi.network.proxy.http": "127.0.0.1:7890",
      "frostpi.network.proxy.https": "127.0.0.1:7891",
    });
    expect(legacy.values).toEqual({ [MODE]: "custom", [ENDPOINT]: "127.0.0.1:7890" });
    expect(legacy.notices.join(" ")).toContain("legacy");
    expect(validateDesktopSettings(legacy.values)).toEqual([]);
    const current = await preview({ [MODE]: "custom", [ENDPOINT]: "127.0.0.1:7892", "frostpi.network.proxy.http": "127.0.0.1:7890" });
    expect(current.values[ENDPOINT]).toBe("127.0.0.1:7892");
    const unsafe = await preview({ [MODE]: "custom", "frostpi.network.proxy.http": "http://user:secret@localhost:7890" });
    expect(unsafe.values).toEqual({ [MODE]: "custom" });
    expect(unsafe.notices.join(" ")).toContain("credential-bearing legacy");
    expect(JSON.stringify(unsafe)).not.toContain("secret");
  });

  it.each(['{"secret":', '["secret"]', " ".repeat(1024 * 1024 + 1)])("rejects malformed, non-object, or oversized sources safely (%#)", async (text) => {
    await writeFile(file, text);
    await expect(importVscodeSettings(file)).rejects.toThrow("Cannot import");
    await expect(importVscodeSettings(file)).rejects.not.toThrow("secret");
  });
});
