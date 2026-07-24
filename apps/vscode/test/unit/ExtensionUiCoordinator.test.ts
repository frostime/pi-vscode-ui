import { describe, expect, it, vi } from "vitest";

import { ExtensionUiCoordinator } from "../../src/extension/extension-ui/ExtensionUiCoordinator.js";

describe("Pi extension UI coordination", () => {
  it("removes a dialog after Pi's timeout without sending a late response", () => {
    vi.useFakeTimers();
    const sendExtensionUiResponse = vi.fn();
    const onChange = vi.fn();
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse } as never,
      { onChange, onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    coordinator.handle({ type: "extension_ui_request", id: "r1", method: "confirm", timeout: 500 });
    expect(coordinator.snapshot().pending).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(coordinator.snapshot().pending).toHaveLength(0);
    expect(sendExtensionUiResponse).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("strips terminal escape sequences from status text", () => {
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    coordinator.handle({ type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "preset", statusText: "\u001b[38;5;202mpreset:research\u001b[39m" });
    expect(coordinator.snapshot().statuses[0]?.text).toBe("preset:research");
  });

  it("preserves notify severity and multiline text while stripping terminal escapes", () => {
    const onNotify = vi.fn();
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify, onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    coordinator.handle({
      type: "extension_ui_request",
      id: "n1",
      method: "notify",
      notifyType: "warning",
      message: "line 1\n\u001b[31mline 2\u001b[39m",
    });
    expect(onNotify).toHaveBeenCalledWith("warning", "line 1\nline 2");
  });

  it("clears old-session decorations and can restore them after a cancelled replacement", () => {
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    coordinator.handle({ type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "mode", statusText: "plan" });
    coordinator.handle({ type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "todo", widgetLines: ["one"] });
    const previous = coordinator.snapshot();

    coordinator.clearSessionDecorations();
    expect(coordinator.snapshot()).toMatchObject({ statuses: [], widgets: [] });
    coordinator.restoreSessionDecorations(previous.statuses, previous.widgets);
    expect(coordinator.snapshot()).toMatchObject({ statuses: previous.statuses, widgets: previous.widgets });
  });

  it("returns a user response exactly once", async () => {
    const sendExtensionUiResponse = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    coordinator.handle({ type: "extension_ui_request", id: "r1", method: "input" });
    await coordinator.respond("r1", { value: "answer" });
    expect(sendExtensionUiResponse).toHaveBeenCalledWith("r1", { value: "answer" });
    await expect(coordinator.respond("r1", { value: "again" })).rejects.toThrow(/no longer pending/);
  });

  it("keeps multiple Question requests pending and cancels all of them on session teardown", async () => {
    const sendExtensionUiResponse = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    for (const id of ["question-1", "question-2"]) {
      coordinator.addPending({
        id,
        method: "question",
        title: "Scope",
        requestId: `${id}-payload`,
        questions: [{ id: "scope", label: "Scope", prompt: "Choose scope", options: [] }],
        receivedAt: 1,
      });
    }

    expect(coordinator.snapshot().pending.map((request) => request.id)).toEqual(["question-1", "question-2"]);
    await coordinator.cancelAll();
    expect(coordinator.snapshot().pending).toEqual([]);
    expect(sendExtensionUiResponse.mock.calls).toEqual([
      ["question-1", { cancelled: true }],
      ["question-2", { cancelled: true }],
    ]);
  });

  it("routes set_editor_text to the host composer effect", () => {
    const onEditorText = vi.fn();
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText },
    );
    coordinator.handle({ type: "extension_ui_request", id: "e1", method: "set_editor_text", text: "draft from extension" });
    expect(onEditorText).toHaveBeenCalledWith("draft from extension");
  });
});
