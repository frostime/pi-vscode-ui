import type { RpcEvent } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { PiAssistantMessageAdapter } from "../../src/extension/conversation/PiAssistantMessageAdapter.js";

describe("Pi assistant message version adaptation", () => {
  it("uses consecutive Pi 0.83 cumulative messages without appending their deltas again", () => {
    const adapter = new PiAssistantMessageAdapter();

    adapter.adapt(update(
      { type: "text_delta", contentIndex: 0, delta: "hel" },
      assistant([
        { type: "text", text: "hel" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a" } },
      ]),
    ));
    const result = adapter.adapt(update(
      { type: "text_delta", contentIndex: 0, delta: "lo" },
      assistant([
        { type: "text", text: "hello" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
      ]),
    ));

    expect(result?.parts).toEqual([
      { type: "text", contentIndex: 0, text: "hello" },
      {
        type: "tool",
        contentIndex: 1,
        tool: { state: "bound", id: "call-1", name: "read", arguments: { path: "a.ts" } },
      },
    ]);
  });

  it("assembles interleaved Pi 0.84 text and thinking parts by contentIndex", () => {
    const adapter = startedAdapter();

    adapter.adapt(update({ type: "text_start", contentIndex: 2 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 2, delta: "answer" }));
    adapter.adapt(update({ type: "thinking_start", contentIndex: 0 }));
    const result = adapter.adapt(update({ type: "thinking_delta", contentIndex: 0, delta: "reason" }));

    expect(result?.parts).toEqual([
      { type: "thinking", contentIndex: 0, text: "reason" },
      { type: "text", contentIndex: 2, text: "answer" },
    ]);
  });

  it("closes text and thinking parts after their first end value", () => {
    const adapter = startedAdapter();

    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "draft" }));
    adapter.adapt(update({ type: "thinking_start", contentIndex: 1 }));
    adapter.adapt(update({ type: "thinking_delta", contentIndex: 1, delta: "temporary" }));
    adapter.adapt(update({ type: "text_end", contentIndex: 0, content: "final text" }));
    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "late" }))).toBeUndefined();
    expect(adapter.adapt(update({ type: "text_end", contentIndex: 0, content: "replacement" }))).toBeUndefined();
    adapter.adapt(update({ type: "thinking_end", contentIndex: 1, content: "final thought" }));
    expect(adapter.adapt(update({ type: "thinking_delta", contentIndex: 1, delta: "late" }))).toBeUndefined();
    expect(adapter.adapt(update({ type: "thinking_end", contentIndex: 1, content: "replacement" }))).toBeUndefined();

    const result = adapter.adapt(update({ type: "toolcall_start", contentIndex: 2 }));
    expect(result?.parts).toEqual([
      { type: "text", contentIndex: 0, text: "final text" },
      { type: "thinking", contentIndex: 1, text: "final thought" },
      { type: "tool", contentIndex: 2, tool: { state: "preparing", rawArguments: "" } },
    ]);
  });

  it("keeps one preparing tool while raw arguments grow and then binds the real tool", () => {
    const adapter = startedAdapter();

    expect(adapter.adapt(update({ type: "toolcall_start", contentIndex: 1 }))?.parts).toEqual([
      { type: "tool", contentIndex: 1, tool: { state: "preparing", rawArguments: "" } },
    ]);
    expect(adapter.adapt(update({ type: "toolcall_delta", contentIndex: 1, delta: '{"path":' }))?.parts).toEqual([
      { type: "tool", contentIndex: 1, tool: { state: "preparing", rawArguments: '{"path":' } },
    ]);
    expect(adapter.adapt(update({
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
    }))?.parts).toEqual([
      {
        type: "tool",
        contentIndex: 1,
        tool: { state: "bound", id: "call-1", name: "read", arguments: { path: "a.ts" } },
      },
    ]);
  });

  it("keeps multiple tool content indexes independent through real-ID binding", () => {
    const adapter = startedAdapter();

    adapter.adapt(update({ type: "toolcall_start", contentIndex: 3 }));
    adapter.adapt(update({ type: "toolcall_start", contentIndex: 1 }));
    adapter.adapt(update({ type: "toolcall_delta", contentIndex: 3, delta: "three" }));
    expect(adapter.adapt(update({ type: "toolcall_delta", contentIndex: 1, delta: "one" }))?.parts).toEqual([
      { type: "tool", contentIndex: 1, tool: { state: "preparing", rawArguments: "one" } },
      { type: "tool", contentIndex: 3, tool: { state: "preparing", rawArguments: "three" } },
    ]);
    adapter.adapt(update({
      type: "toolcall_end",
      contentIndex: 3,
      toolCall: { id: "call-3", name: "write", arguments: { value: 3 } },
    }));
    const result = adapter.adapt(update({
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { id: "call-1", name: "read", arguments: { value: 1 } },
    }));

    expect(result?.parts).toEqual([
      {
        type: "tool",
        contentIndex: 1,
        tool: { state: "bound", id: "call-1", name: "read", arguments: { value: 1 } },
      },
      {
        type: "tool",
        contentIndex: 3,
        tool: { state: "bound", id: "call-3", name: "write", arguments: { value: 3 } },
      },
    ]);
  });

  it("lets message_end replace the temporary message and close adapter state", () => {
    const adapter = startedAdapter();
    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "draft" }));

    const result = adapter.adapt({
      type: "message_end",
      message: assistant([{ type: "text", text: "authoritative" }], { stopReason: "stop" }),
    });

    expect(result).toMatchObject({
      phase: "final",
      stopReason: "stop",
      parts: [{ type: "text", contentIndex: 0, text: "authoritative" }],
    });
    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "late" }))).toBeUndefined();
    expect(adapter.adapt(update(
      { type: "text_delta", contentIndex: 0, delta: "late cumulative" },
      assistant([{ type: "text", text: "late cumulative" }]),
    ))).toBeUndefined();

    adapter.adapt({ type: "message_start", message: assistant([]) });
    expect(adapter.adapt(update(
      { type: "text_delta", contentIndex: 0, delta: "next" },
      assistant([{ type: "text", text: "next" }]),
    ))?.parts).toEqual([{ type: "text", contentIndex: 0, text: "next" }]);
  });

  it("publishes a valid message_end even when no message_start was observed", () => {
    const adapter = new PiAssistantMessageAdapter();

    expect(adapter.adapt({
      type: "message_end",
      message: assistant([{ type: "thinking", thinking: "done" }]),
    })).toMatchObject({
      phase: "final",
      parts: [{ type: "thinking", contentIndex: 0, text: "done" }],
    });
  });

  it("ignores an older message_end without clearing the replacement active stream", () => {
    const adapter = new PiAssistantMessageAdapter();
    adapter.adapt({ type: "message_start", message: assistant([], { timestamp: 1 }) });
    adapter.adapt({ type: "message_start", message: assistant([], { timestamp: 2 }) });

    expect(adapter.adapt({
      type: "message_end",
      message: assistant([{ type: "text", text: "late A" }], { timestamp: 1, stopReason: "stop" }),
    })).toBeUndefined();
    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "B" }))).toMatchObject({
      timestamp: 2,
      parts: [{ type: "text", contentIndex: 0, text: "B" }],
    });
  });

  it("ignores malformed or out-of-order deltas without corrupting valid parts", () => {
    const adapter = startedAdapter();
    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "ok" }));
    expect(adapter.adapt({
      type: "message_start",
      message: { role: "assistant", content: [] },
    })).toBeUndefined();
    expect(adapter.adapt({
      type: "message_start",
      message: { role: "user", content: "unrelated", timestamp: 200 },
    })).toBeUndefined();
    expect(adapter.adapt(update(
      { type: "text_delta", contentIndex: 0, delta: "identity-less" },
      { role: "assistant", content: [{ type: "text", text: "identity-less" }] },
    ))).toBeUndefined();

    const malformed = [
      { type: "text_delta", contentIndex: -1, delta: "bad" },
      { type: "text_delta", contentIndex: 2, delta: "not started" },
      { type: "thinking_delta", contentIndex: 0, delta: "wrong type" },
      { type: "text_end", contentIndex: 0 },
      { type: "unknown_delta", contentIndex: 0, delta: "bad" },
    ];
    for (const delta of malformed) expect(adapter.adapt(update(delta))).toBeUndefined();

    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "!" }))?.parts).toEqual([
      { type: "text", contentIndex: 0, text: "ok!" },
    ]);
    expect(adapter.adapt({
      type: "message_end",
      message: assistant([{ type: "text", text: "recovered" }], { stopReason: "stop" }),
    })?.parts).toEqual([{ type: "text", contentIndex: 0, text: "recovered" }]);
  });

  it("does not carry partial content across reset or a replacement message_start", () => {
    const adapter = startedAdapter();
    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "old" }));

    adapter.reset();
    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "leak" }))).toBeUndefined();

    adapter.adapt({ type: "message_start", message: assistant([]) });
    adapter.adapt(update({ type: "text_start", contentIndex: 0 }));
    adapter.adapt(update({ type: "text_delta", contentIndex: 0, delta: "discarded" }));
    adapter.adapt({ type: "message_start", message: assistant([]) });
    adapter.adapt(update({ type: "text_start", contentIndex: 1 }));
    expect(adapter.adapt(update({ type: "text_delta", contentIndex: 1, delta: "new" }))?.parts).toEqual([
      { type: "text", contentIndex: 1, text: "new" },
    ]);
  });
});

function startedAdapter(): PiAssistantMessageAdapter {
  const adapter = new PiAssistantMessageAdapter();
  adapter.adapt({ type: "message_start", message: assistant([]) });
  return adapter;
}

function update(assistantMessageEvent: Record<string, unknown>, message?: Record<string, unknown>): RpcEvent {
  return {
    type: "message_update",
    assistantMessageEvent,
    ...(message ? { message } : {}),
  };
}

function assistant(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: "assistant", content, timestamp: 100, ...extra };
}
