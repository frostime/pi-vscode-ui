import { beforeEach, describe, expect, it, vi } from "vitest";

const vscodeMocks = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showWarningDialog: vi.fn(),
}));

const { confirmDraftReplacement, pickBranchEnd, pickBranchSummary, pickRewindTarget } = await import(
  "../../src/host/pickers/SessionTreePicker.js"
);

function fakeHost(): never {
  return {
    window: {
      showQuickPick: vscodeMocks.showQuickPick,
      showInputBox: vscodeMocks.showInputBox,
      showWarningDialog: vscodeMocks.showWarningDialog,
    },
  } as never;
}

beforeEach(() => {
  vscodeMocks.showQuickPick.mockReset();
  vscodeMocks.showInputBox.mockReset();
  vscodeMocks.showWarningDialog.mockReset();
});

describe("SessionTreePicker", () => {
  it("returns the selected branch projection from QuickPick", async () => {
    vscodeMocks.showQuickPick.mockImplementation((items: unknown[]) => Promise.resolve(items[3]));
    const choices = [
      choice("current", true),
      choice("other", false),
    ];

    await expect(pickBranchEnd(fakeHost(), choices)).resolves.toEqual(choices[1]);
    const items = vscodeMocks.showQuickPick.mock.calls[0]?.[0] as Array<{ label: string; description?: string; detail?: string; kind?: string }>;
    expect(items.map((item) => item.label)).toEqual([
      "Current path",
      "$(check) current",
      "Other paths",
      "$(git-branch) other",
    ]);
    expect(items[0]?.kind).toBe("separator");
    expect(items[2]?.kind).toBe("separator");
    expect(items[3]?.description).toMatch(/^2 messages · updated /);
    expect(items[3]?.detail).toMatch(/^2 messages · updated .* · Ends with assistant/);
  });

  it("uses no summary as the first/default choice and supports default summary", async () => {
    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[0]));
    await expect(pickBranchSummary(fakeHost())).resolves.toEqual({ summarize: false });

    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[1]));
    await expect(pickBranchSummary(fakeHost())).resolves.toEqual({ summarize: true });
  });

  it("collects trimmed custom summary focus and preserves cancellation", async () => {
    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[2]));
    vscodeMocks.showInputBox.mockResolvedValueOnce("  decisions only  ");
    await expect(pickBranchSummary(fakeHost())).resolves.toEqual({ summarize: true, customInstructions: "decisions only" });

    vscodeMocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(pickBranchSummary(fakeHost())).resolves.toBeUndefined();

    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[2]));
    vscodeMocks.showInputBox.mockResolvedValueOnce(undefined);
    await expect(pickBranchSummary(fakeHost())).resolves.toBeUndefined();
  });

  it("offers rewind targets with what each removes and states that files are untouched", async () => {
    const targets = [
      { targetId: "latest", label: "Add tests", hasImages: true, removedMessageCount: 1, sentAt: Date.now() - 2 * 60_000 },
      { targetId: "earlier", label: "Fix parser", hasImages: false, removedMessageCount: 2, sentAt: Date.now() - 3 * 3_600_000 },
      { targetId: "first", label: "Start", hasImages: false, removedMessageCount: 9, sentAt: 0 },
    ];
    vscodeMocks.showQuickPick.mockImplementationOnce((items: unknown[]) => Promise.resolve(items[1]));

    await expect(pickRewindTarget(fakeHost(), targets)).resolves.toEqual(targets[1]);

    const [items, options] = vscodeMocks.showQuickPick.mock.calls[0] as [Array<{ label: string; description?: string; detail?: string }>, { title: string; placeHolder: string }];
    expect(items.map(({ label, description, detail }) => ({ label, description, detail }))).toEqual([
      { label: "$(history) Add tests $(file-media)", description: "2m ago", detail: "Returns to before this prompt" },
      { label: "$(history) Fix parser", description: "3h ago", detail: "Returns to before this prompt · 1 later message leaves the context" },
      { label: "$(history) Start", description: "", detail: "Returns to before this prompt · 8 later messages leave the context" },
    ]);
    expect(options.title).toBe("Rewind conversation");
    expect(options.placeHolder).toContain("files on disk are not changed");

    vscodeMocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(pickRewindTarget(fakeHost(), targets)).resolves.toBeUndefined();
  });

  it("confirms Composer draft replacement only on the explicit action", async () => {
    vscodeMocks.showWarningDialog.mockResolvedValueOnce("Replace draft");
    await expect(confirmDraftReplacement(fakeHost())).resolves.toBe(true);
    vscodeMocks.showWarningDialog.mockResolvedValueOnce(undefined);
    await expect(confirmDraftReplacement(fakeHost())).resolves.toBe(false);
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
