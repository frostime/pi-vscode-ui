import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FILE_LINK_SECTION, WEB_LINK_SECTION } from "$shared/model/linkContextMenu";

describe("link context menu manifest", () => {
  it("matches the manifest's webview context menu entries", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      contributes: { commands: Array<{ command: string }>; menus: Record<string, Array<{ command: string; when?: string }>> };
    };
    const entries = manifest.contributes.menus["webview/context"] ?? [];
    const declared = new Set(manifest.contributes.commands.map((entry) => entry.command));
    const hidden = new Set((manifest.contributes.menus["commandPalette"] ?? [])
      .filter((entry) => entry.when === "false").map((entry) => entry.command));
    for (const [command, section] of [["frostpi.copyLinkAddress", WEB_LINK_SECTION], ["frostpi.copyLinkPath", FILE_LINK_SECTION]] as const) {
      const entry = entries.find((candidate) => candidate.command === command);
      expect(entry?.when).toContain(`webviewSection == '${section}'`);
      expect(entry?.when).toContain("webviewId == 'frostpi.chat'");
      // Session Tabs have numbered Webview types (SessionPanelManager).
      expect(entry?.when).toContain("webviewId =~ /^frostpi\\.session\\.[0-9]+$/");
      expect(declared.has(command)).toBe(true);
      expect(hidden.has(command)).toBe(true);
    }
  });
});
