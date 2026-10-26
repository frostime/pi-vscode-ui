import { describe, expect, it } from "vitest";
import { desktopOnlySettingDefinitions, desktopSettingDefinitions } from "../src/shared/desktopSettings.js";
import { settingsPages, settingsByKey, matchesSettingSearch } from "../src/renderer/settingsPresentation.js";
import { changedSettingKeys, createSettingsDraft, mergeSettingsDraft, parseSettingsDraft, settingDraftValue, type SettingsDraft } from "../src/renderer/settingsForm.js";

describe("Desktop settings presentation and original-key drafts", () => {
  it("places every schema key exactly once without mixing Desktop identity with visual grouping", () => {
    const displayed = settingsPages.flatMap((page) => page.sections.flatMap((section) => section.settings.map((setting) => setting.key)));
    expect([...displayed].sort()).toEqual(Object.keys(desktopSettingDefinitions).sort());
    expect(new Set(displayed).size).toBe(displayed.length);
    expect(Object.keys(desktopOnlySettingDefinitions).every((key) => key.startsWith("desktop."))).toBe(true);
    expect(settingsPages.find((page) => page.id === "appearance")?.sections[0]?.settings[0]?.key).toBe("desktop.theme");
    expect(Object.values(settingsByKey).every((setting) => setting.label !== setting.key)).toBe(true);
  });

  it("finds friendly labels and full original keys across groups", () => {
    expect(matchesSettingSearch(settingsByKey["chat.editor.fontSize"]!, "COMPOSER size")).toBe(true);
    expect(matchesSettingSearch(settingsByKey["frostpi.network.proxy.endpoint"]!, "frostpi.network.proxy.endpoint")).toBe(true);
    expect(matchesSettingSearch(settingsByKey["chat.fontSize"]!, "proxy")).toBe(false);
  });

  it("round-trips display units, false overrides, empty strings and structured values without pinning defaults", () => {
    const values = {
      "frostpi.attachments.maxImageBytes": 1234567,
      "frostpi.pi.executable": "",
      "frostpi.questionTool.enabled": false,
      "frostpi.session.startOnOpen": false,
      "chat.fontFamily": "",
      "frostpi.pi.arguments": ["--session-dir", "a path with spaces"],
      "files.exclude": { "**/.git": false, "*.js": { when: "$(basename).ts" } },
    };
    const draft = createSettingsDraft(values);
    expect(Number(draft["frostpi.attachments.maxImageBytes"])).toBe(1234567 / (1024 * 1024));
    expect(parseSettingsDraft(draft)).toEqual({ values, errors: {} });
    expect(settingDraftValue("files.exclude", {})).toBe("{}");
    expect(settingDraftValue("frostpi.session.startOnOpen", draft)).toBe(false);
    expect(settingDraftValue("chat.fontFamily", draft)).toBe("");
    expect(parseSettingsDraft({}).values).toEqual({});
  });

  it("round-trips whole-window Zoom percentages independently of interface and chat sizes", () => {
    const values = { "desktop.zoomFactor": 1.25, "desktop.ui.fontFamily": "Georgia, serif", "desktop.ui.fontSize": 18, "chat.fontSize": 22 };
    const draft = createSettingsDraft(values);
    expect(draft["desktop.zoomFactor"]).toBe("125");
    expect(settingDraftValue("desktop.zoomFactor", {})).toBe("100");
    expect(parseSettingsDraft(draft)).toEqual({ values, errors: {} });
    const invalid = parseSettingsDraft({ "desktop.zoomFactor": "250", "desktop.ui.fontSize": "8" }).errors;
    expect(invalid["desktop.zoomFactor"]).toContain("200");
    expect(invalid["desktop.ui.fontSize"]).toContain("10");
  });

  it("adopts external shortcut changes without losing edited fields or Reset intent", () => {
    const saved = createSettingsDraft({ "desktop.zoomFactor": 1.25, "chat.fontSize": 18, "desktop.theme": "dark" });
    const draft: SettingsDraft = { ...saved, "chat.fontSize": "22" };
    delete draft["desktop.theme"];
    const next = mergeSettingsDraft(saved, draft, { "desktop.zoomFactor": 1.35, "chat.fontSize": 18, "desktop.theme": "dark" });
    expect(next.draft["desktop.zoomFactor"]).toBe("135");
    expect(next.draft["chat.fontSize"]).toBe("22");
    expect(next.draft["desktop.theme"]).toBeUndefined();
    expect(changedSettingKeys(next.saved, next.draft).sort()).toEqual(["chat.fontSize", "desktop.theme"]);
    // An explicit local Zoom edit, unlike an untouched field, wins until Save/Discard.
    const local = mergeSettingsDraft(next.saved, { ...next.draft, "desktop.zoomFactor": "150" }, { "desktop.zoomFactor": 1.45, "chat.fontSize": 18, "desktop.theme": "dark" });
    expect(local.draft["desktop.zoomFactor"]).toBe("150");
  });

  it("keeps Reset distinct from an explicit default-valued override", () => {
    const saved = createSettingsDraft({ "chat.fontSize": 13, "frostpi.questionTool.enabled": false });
    const draft = { ...saved };
    delete draft["chat.fontSize"];
    expect(changedSettingKeys(saved, draft)).toEqual(["chat.fontSize"]);
    expect(parseSettingsDraft(draft).values).toEqual({ "frostpi.questionTool.enabled": false });
    expect(settingDraftValue("chat.fontSize", draft)).toBe("13");
  });

  it("reports invalid unfinished numbers, JSON structure and process dependencies at their owning fields", () => {
    const parsed = parseSettingsDraft({
      "chat.fontSize": "",
      "frostpi.attachments.maxImageBytes": "51",
      "frostpi.pi.arguments": "{}",
      "files.exclude": "[",
      "frostpi.network.proxy.mode": "custom",
    });
    expect(Object.keys(parsed.errors).sort()).toEqual([
      "chat.fontSize", "frostpi.attachments.maxImageBytes", "frostpi.pi.arguments", "files.exclude", "frostpi.network.proxy.endpoint",
    ].sort());
    const unavailable = parseSettingsDraft({ "frostpi.network.proxy.mode": "vscode", "frostpi.notifications.experimental.enabled": true }).errors;
    expect(unavailable["frostpi.network.proxy.mode"]).toContain("unavailable");
    expect(unavailable["frostpi.notifications.experimental.enabled"]).toContain("unavailable");
  });
});
