import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { SessionEntryPathError, SessionEntryState } from "../../src/extension/sessions/SessionEntryState.js";

describe("SessionEntryState", () => {
  it("selects the complete active path and retains only content-free tree nodes", () => {
    const state = new SessionEntryState();
    const update = state.replace([
      message("root", null, "user", "start"),
      message("answer", "root", "assistant", "answer"),
      message("abandoned", "answer", "user", "old branch"),
      message("active", "answer", "user", "new branch"),
    ], "active");

    expect(update.activePath.map((entry) => entry.id)).toEqual(["root", "answer", "active"]);
    expect(update.index.activePath).toEqual(["root", "answer", "active"]);
    expect(update.index.childrenByParentId.get("answer")).toEqual(["abandoned", "active"]);
    expect(update.index.entriesById.get("active")).toEqual({
      id: "active",
      type: "message",
      parentId: "answer",
      messageRole: "user",
    });
  });

  it("rejects missing and cyclic parents on the selected path", () => {
    const state = new SessionEntryState();

    expect(() => state.replace([message("leaf", "missing", "assistant", "answer")], "leaf"))
      .toThrow(SessionEntryPathError);
    expect(() => state.replace([
      message("cycle-a", "cycle-b", "user", "a"),
      message("cycle-b", "cycle-a", "assistant", "b"),
    ], "cycle-b")).toThrow(SessionEntryPathError);
  });

  it("accepts only a batch that connects the previous leaf to the reported leaf", () => {
    const state = new SessionEntryState();
    state.replace([
      message("root", null, "user", "start"),
      message("answer", "root", "assistant", "answer"),
    ], "answer");

    const update = state.applyIncrement([
      message("abandoned", "root", "user", "other branch"),
      entry("tool", "answer", "toolResult"),
      message("next", "tool", "user", "continue"),
    ], "next");

    expect(update.kind).toBe("append");
    if (update.kind !== "append") return;
    expect(update.activePathAppend.map((entry) => entry.id)).toEqual(["tool", "next"]);
    expect(update.index.activePath).toEqual(["root", "answer", "tool", "next"]);
    expect(update.index.entriesById.has("abandoned")).toBe(true);
    expect(state.cursor).toBe("next");
  });

  it("requests a complete reload without mutating state when the leaf moves branches", () => {
    const state = new SessionEntryState();
    state.replace([
      message("root", null, "user", "start"),
      message("active", "root", "assistant", "answer"),
    ], "active");

    expect(state.applyIncrement([message("other", "root", "user", "branch")], "other")).toEqual({
      kind: "reload",
      reason: "active-leaf-not-continued",
    });
    expect(state.leafId).toBe("active");
    expect(state.index.entriesById.has("other")).toBe(false);
  });

  it("advances append-order cursor when the active leaf is unchanged", () => {
    const state = new SessionEntryState();
    state.replace([message("root", null, "user", "start")], "root");

    const update = state.applyIncrement([entry("metadata", "root", "model_change")], "root");

    expect(update.kind).toBe("append");
    expect(state.cursor).toBe("metadata");
    expect(state.index.activePath).toEqual(["root"]);
    expect(state.index.entriesById.has("metadata")).toBe(true);
  });

  it("requires a full load before accepting incremental entries", () => {
    const state = new SessionEntryState();

    expect(state.applyIncrement([], null)).toEqual({ kind: "reload", reason: "not-initialized" });
  });
});

function message(
  id: string,
  parentId: string | null,
  role: string,
  content: string,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    message: { role, content },
  };
}

function entry(id: string, parentId: string | null, type: string): RpcSessionEntry {
  return { type, id, parentId };
}
