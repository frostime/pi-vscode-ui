import { beforeEach, describe, expect, it, vi } from "vitest";

const vscodeMocks = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
  QuickPickItemKind: { Separator: -1 },
  window: vscodeMocks,
}));

const { confirmDraftReplacement, pickBranchEnd, pickBranchSummary } = await import(
  "../../src/extension/sessions/tree/SessionTreePicker.js"
);

beforeEach(() => {
  vscodeMocks.showQuickPick.mockReset();
  vscodeMocks.showInputBox.mockReset();
  vscodeMocks.showWarningMessage.mockReset();
});

describe("SessionTreePicker", () => {
  it("returns the selected branch projection from QuickPick", async () => {
    vscodeMocks.showQuickPick.mockImplementation((items: unknown[]) => Promise.resolve(items[3]));
    const choices = [
      choice("current", true),
      choice("other", false),
    ];

    await expect(pickBranchEnd(choices)).resolves.toEqual(choices[1]);
    const items = vscodeMocks.showQuickPick.mock.calls[0]?.[0] as Array<{ label: string; description?: string; detail?: string; kind?: number }>;
    expect(items.map((item) => item.label)).toEqual([
      "Current path",
      "$(check) current",
      "Other paths",
      "$(git-branch) other",
    ]);
    expect(items[0]?.kind).toBe(-1);
    expect(items[2]?.kind).toBe(-1);
    expect(items[3]?.description).toMatch(/^2 messages · updated /);
    expect(items[3]?.detail).toMatch(/^2 messages · updated .* · Ends with assistant/);
  });

  it("uses no summary as the first/default choice and supports default summary", async () => {
    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[0]));
    await expect(pickBranchSummary()).resolves.toEqual({ summarize: false });

    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[1]));
    await expect(pickBranchSummary()).resolves.toEqual({ summarize: true });
  });

  it("collects trimmed custom summary focus and preserves cancellation", async () => {
    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[2]));
    vscodeMocks.showInputBox.mockResolvedValueOnce("  decisions only  ");
    await expect(pickBranchSummary()).resolves.toEqual({ summarize: true, customInstructions: "decisions only" });

    vscodeMocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(pickBranchSummary()).resolves.toBeUndefined();

    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[2]));
    vscodeMocks.showInputBox.mockResolvedValueOnce(undefined);
    await expect(pickBranchSummary()).resolves.toBeUndefined();
  });

  it("confirms Composer draft replacement only on the explicit action", async () => {
    vscodeMocks.showWarningMessage.mockResolvedValueOnce("Replace draft");
    await expect(confirmDraftReplacement()).resolves.toBe(true);
    vscodeMocks.showWarningMessage.mockResolvedValueOnce(undefined);
    await expect(confirmDraftReplacement()).resolves.toBe(false);
  });
});

function choice(label: string, isCurrent: boolean) {
  return {
    targetId: `${label}-id`,
    label,
    description: isCurrent ? "Current · 2 messages" : "2 messages",
    detail: "Ends with assistant: answer",
    isCurrent,
    isEditable: false,
    messageCount: 2,
    updatedAt: Date.now() - 5 * 60_000,
  };
}
