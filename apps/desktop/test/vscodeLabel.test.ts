import { describe, expect, it } from "vitest";
import { parseVscodeLabel, vscodeLabelText } from "../src/renderer/vscodeLabel.js";
import { quickPickMatches } from "../src/renderer/quickPick.js";

describe("VS Code QuickPick label semantics", () => {
  it("renders icon names and modifiers as classes without losing label text", () => {
    expect(parseVscodeLabel("$(git-branch) Main $(sync~spin)")).toEqual([
      { kind: "icon", className: "codicon codicon-git-branch" },
      { kind: "text", text: " Main " },
      { kind: "icon", className: "codicon codicon-sync codicon-modifier-spin" },
    ]);
    expect(vscodeLabelText("$(git-branch) Main")).toBe(" Main");
  });

  it("keeps escaped markers and non-icon text literal rather than treating it as HTML", () => {
    const label = String.raw`\$(folder) $(not an icon) <img src=x>`;
    expect(parseVscodeLabel(label)).toEqual([
      { kind: "text", text: "$(folder)" },
      { kind: "text", text: " $(not an icon) <img src=x>" },
    ]);
  });

  it("searches visible text and only the description/detail fields enabled by the caller", () => {
    const item = { id: "choice", label: "$(git-branch) Main", description: "Alpha", detail: "Beta" };
    const labelOnly = { matchOnDescription: false, matchOnDetail: false };
    expect(quickPickMatches(item, "main", labelOnly)).toBe(true);
    expect(quickPickMatches(item, "git-branch", labelOnly)).toBe(false);
    expect(quickPickMatches(item, "alpha", labelOnly)).toBe(false);
    expect(quickPickMatches(item, "alpha", { ...labelOnly, matchOnDescription: true })).toBe(true);
    expect(quickPickMatches(item, "beta", labelOnly)).toBe(false);
    expect(quickPickMatches(item, "beta", { ...labelOnly, matchOnDetail: true })).toBe(true);
    expect(quickPickMatches({ ...item, alwaysShow: true }, "no match", labelOnly)).toBe(true);
  });
});
