import { appendFile, readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionCommandsHost, userPrompts } from "../fixtures/sessionCommandsHost.js";

// The 8 MiB budget scaled down, so these sessions stay small and fast; the logic is the same.
vi.mock("../../src/core/sessions/historyWindow.js", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  FULL_HISTORY_LOAD_BYTES: 64 * 1024,
}));

/** Bytes of tool output per step: 13 of them put a session file above the 64 KiB test budget. */
const STEP_OUTPUT = "synthetic-tool-output ".repeat(256);

/**
 * Appends entries to a stopped session's file the way Pi writes them, continuing its
 * current leaf, so the next start resumes them. Returns the ids by label.
 */
async function appendToSession(file: string, script: Array<{ user: string } | { assistant: string } | { tools: number }>): Promise<Map<string, string>> {
  const existing = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id: string });
  let parentId: string | null = existing.at(-1)?.id ?? null;
  let sequence = 0;
  const ids = new Map<string, string>();
  const lines: string[] = [];
  const entry = (message: Record<string, unknown>): string => {
    const id = `appended-${++sequence}`;
    lines.push(JSON.stringify({ type: "message", id, parentId, timestamp: new Date(sequence * 1000).toISOString(), message: { timestamp: sequence * 1000, ...message } }));
    parentId = id;
    return id;
  };
  for (const step of script) {
    if ("user" in step) ids.set(step.user, entry({ role: "user", content: step.user }));
    else if ("assistant" in step) ids.set(step.assistant, entry({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: step.assistant }] }));
    else {
      for (let index = 0; index < step.tools; index += 1) {
        const callId = `call-${sequence}`;
        entry({ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: callId, name: "bash", arguments: { command: "echo" } }] });
        entry({ role: "toolResult", toolCallId: callId, toolName: "bash", isError: false, content: [{ type: "text", text: STEP_OUTPUT }] });
      }
    }
  }
  await appendFile(file, `${lines.join("\n")}\n`);
  return ids;
}

describe("a session file above the full-load budget", () => {
  const fixtures: Awaited<ReturnType<typeof sessionCommandsHost>>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose())); });

  /** A saved session whose file then grows by `script`, reopened from that file. */
  async function reopenedSession(script: Parameters<typeof appendToSession>[1]) {
    const fixture = await sessionCommandsHost();
    fixtures.push(fixture);
    const { registry, view } = fixture;
    const sessionId = await fixture.startSession();
    await fixture.converse(sessionId, "first");
    await fixture.converse(sessionId, "second");
    const file = view(sessionId).sessionFile!;
    await registry.stopSession(sessionId);
    const ids = await appendToSession(file, script);
    await registry.retrySession(sessionId);
    await fixture.waitFor(() => view(sessionId).status === "ready"
      && (view(sessionId).historyStatus === "loaded" || view(sessionId).historyStatus === "deferred"), 10_000);
    // Stopping may cut off the reconcile that follows the last turn; only what happens
    // after the reopen matters here.
    fixture.errors.splice(0);
    return { fixture, registry, view, sessionId, ids };
  }

  const LONG_THEN_RECENT = [
    { user: "old work" }, { tools: 13 }, { assistant: "old work done" },
    { user: "target" }, { assistant: "target done" },
    { user: "latest" }, { assistant: "latest done" },
  ];

  it("opens on the current branch from its latest prompt, keeps that start as turns arrive, and loads in full on request", async () => {
    const { fixture, registry, view, sessionId } = await reopenedSession(LONG_THEN_RECENT);
    expect(view(sessionId)).toMatchObject({ historyStatus: "loaded", partialHistory: true });
    expect(userPrompts(view(sessionId))).toEqual(["latest"]);

    await fixture.converse(sessionId, "next");
    expect(userPrompts(view(sessionId))).toEqual(["latest", "next"]);

    await registry.loadHistory(sessionId);
    expect(view(sessionId).partialHistory).toBeUndefined();
    expect(userPrompts(view(sessionId))).toEqual(["first", "second", "old work", "target", "latest", "next"]);
    expect(fixture.errors).toEqual([]);
  });

  it("loads the full history before Branch here, so the new branch end outside the preview rebuilds", async () => {
    const { fixture, registry, view, sessionId, ids } = await reopenedSession(LONG_THEN_RECENT);
    expect(view(sessionId).partialHistory).toBe(true);

    fixture.quickPicks.push((items) => items[0]);
    await expect(registry.branchHere(sessionId, ids.get("latest")!, false)).resolves.toEqual({ cancelled: false });

    expect(view(sessionId).partialHistory).toBeUndefined();
    expect(userPrompts(view(sessionId))).toEqual(["first", "second", "old work", "target"]);
    expect(view(sessionId).composerSeed).toMatchObject({ text: "latest" });
    expect(fixture.errors).toEqual([]);
  });

  it("loads the full history before listing Switch branch candidates", async () => {
    const { fixture, registry, view, sessionId } = await reopenedSession(LONG_THEN_RECENT);
    expect(view(sessionId).partialHistory).toBe(true);

    await expect(registry.switchBranch(sessionId, null, false)).resolves.toEqual({ cancelled: true });

    expect(view(sessionId).partialHistory).toBeUndefined();
    expect(fixture.shownQuickPicks).toEqual([expect.objectContaining({ title: "Switch branch" })]);
  });

  it("forks an older message while busy, with the second Pi process holding the full history", async () => {
    const { fixture, registry, view, sessionId } = await reopenedSession(LONG_THEN_RECENT);
    await registry.loadHistory(sessionId);
    const second = view(sessionId).conversationItems.flatMap((item) => item.type === "turn" && item.userMessage?.blocks.some((block) => block.type === "text" && block.text === "second") ? [item.userMessage.sourceEntryId] : [])[0]!;
    await registry.sendPrompt(sessionId, "hold", []);
    await fixture.waitFor(() => view(sessionId).isStreaming);

    const result = await registry.forkMessage(sessionId, second, "preserve-sidebar-selection");

    expect(result).toEqual({ cancelled: false, forkSessionId: expect.any(String) as string });
    expect(view(result.forkSessionId!)).toMatchObject({ historyStatus: "loaded", composerSeed: { text: "second" } });
    expect(view(result.forkSessionId!).partialHistory).toBeUndefined();
    expect(userPrompts(view(result.forkSessionId!))).toEqual(["first"]);
    expect(view(sessionId).isStreaming).toBe(true);
    await registry.abort(sessionId);
  });

  it("waits for the user, and says why, when no prompt of the current branch fits the budget", async () => {
    const { registry, view, sessionId } = await reopenedSession([{ user: "only prompt" }, { tools: 13 }, { assistant: "end" }]);
    expect(view(sessionId).historyStatus).toBe("deferred");
    expect(view(sessionId).historyDeferredReason).toContain("No prompt of its current branch lies within the last");
    expect(view(sessionId).partialHistory).toBeUndefined();
    // Nothing of the reopened file is shown; what the restarted view held before stays.
    expect(userPrompts(view(sessionId))).not.toContain("only prompt");

    await registry.loadHistory(sessionId);
    expect(userPrompts(view(sessionId))).toEqual(["first", "second", "only prompt"]);
    expect(view(sessionId).historyDeferredReason).toBeUndefined();
  });
});
