import { describe, expect, it, vi } from "vitest";

import { ExtensionUiCoordinator } from "../../src/core/extension-ui/ExtensionUiCoordinator.js";

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

  it("projects async workers into text and clears a completed widget on the next empty snapshot", () => {
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    const send = (runs: unknown[]) => coordinator.handle({
      type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "subagent-async", widgetPlacement: "belowEditor",
      widgetLines: ["PI_SUBAGENT_ASYNC_JSON:" + JSON.stringify({ kind: "pi-subagents.async-status-snapshot", version: 1, runs })],
    });
    const first = { id: "12345678-abcd-4000-8000-0123456789ab", label: "assistant", state: "queued" };
    const second = { id: "98765432-abcd-4000-8000-0123456789ab", label: "assistant", state: "running",
      children: [{ label: "\u001b[31mreader\u001b[0m\nchild", state: "running", hostStep: { target: "/private" } }] };
    send([first, second]);
    expect(coordinator.snapshot().widgets).toEqual([{ key: "subagent-async", placement: "below",
      lines: ["Subagents", "assistant (12345678) · queued", "assistant (98765432) · running", "  reader child · running"] }]);
    send([{ ...first, state: "complete" }, { ...second, state: "failed", children: [] }]);
    expect(coordinator.snapshot().widgets[0]?.lines).toEqual([
      "Subagents", "assistant (12345678) · complete", "assistant (98765432) · failed",
    ]);
    send([]);
    expect(coordinator.snapshot().widgets).toEqual([]);
  });

  it("keeps unknown snapshots out of the subagent widget and preserves ordinary text widgets", () => {
    const coordinator = new ExtensionUiCoordinator(
      { sendExtensionUiResponse: vi.fn() } as never,
      { onChange: vi.fn(), onNotify: vi.fn(), onTitle: vi.fn(), onEditorText: vi.fn() },
    );
    const send = (key: string, line: string) => coordinator.handle({
      type: "extension_ui_request", id: "w2", method: "setWidget", widgetKey: key, widgetLines: [line],
    });
    for (const payload of ["{", '{"kind":"pi-subagents.async-status-snapshot","version":2,"runs":[]}', "x".repeat(32769)]) {
      send("subagent-async", "PI_SUBAGENT_ASYNC_JSON:" + payload);
      expect(coordinator.snapshot().widgets[0]?.lines).toEqual(["Subagent status unavailable"]);
    }
    send("subagent-async", "Legacy worker status");
    send("other", "PI_SUBAGENT_ASYNC_JSON:example");
    expect(coordinator.snapshot().widgets.map(widget => widget.lines)).toEqual([
      ["Legacy worker status"], ["PI_SUBAGENT_ASYNC_JSON:example"],
    ]);
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
