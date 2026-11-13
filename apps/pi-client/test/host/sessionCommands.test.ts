import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionNoticeView } from "../../src/shared/model/conversationModel.js";
import type { SessionViewModel } from "../../src/shared/model/sessionViewModel.js";
import { sessionCommandsHost, userPrompts } from "../fixtures/sessionCommandsHost.js";

function notices(session: SessionViewModel): string[] {
  return session.conversationItems.filter((item): item is SessionNoticeView => item.type === "notice").map((notice) => notice.text);
}

describe("Host slash commands through the real Registry and child-process path", () => {
  const fixtures: Awaited<ReturnType<typeof sessionCommandsHost>>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose())); });

  async function host(piArguments: string[] = [], options?: { adapters?: boolean }) {
    const fixture = await sessionCommandsHost(piArguments, options);
    fixtures.push(fixture);
    return fixture;
  }

  it("lists its own commands for the Session and keeps the private adapter commands out", async () => {
    const fixture = await host();
    const sessionId = await fixture.startSession();
    expect(fixture.view(sessionId).commands.map(({ name, source }) => `${name}:${source}`)).toEqual([
      "clear:frostpi", "rewind:frostpi", "btw:frostpi", "visible:extension",
    ]);
  });

  it("leaves a command it cannot answer to the runtime instead of intercepting it", async () => {
    // A Host without the bundled adapters: the same text may be the user's own Pi command.
    const fixture = await host([], { adapters: false });
    const { view } = fixture;
    const sessionId = await fixture.startSession();
    expect(view(sessionId).commands.map((command) => command.name)).toEqual(["clear", "visible"]);

    await fixture.converse(sessionId, "/btw is this mine?");
    await fixture.converse(sessionId, "/rewind");

    expect(userPrompts(view(sessionId))).toEqual(["/btw is this mine?", "/rewind"]);
    expect(view(sessionId).sideQuestion).toBeUndefined();
    expect(fixture.shownQuickPicks).toEqual([]);
  });

  it("stops offering and intercepting a command whose adapter did not load in this process", async () => {
    // The adapters were passed to Pi, but its command list shows it loaded neither.
    const fixture = await host(["--adapters-not-loaded"]);
    const { view } = fixture;
    const sessionId = await fixture.startSession();
    expect(view(sessionId).commands.map((command) => command.name)).toEqual(["clear", "visible"]);

    await fixture.converse(sessionId, "/btw is this mine?");
    await fixture.converse(sessionId, "/rewind");

    expect(userPrompts(view(sessionId))).toEqual(["/btw is this mine?", "/rewind"]);
    expect(view(sessionId).sideQuestion).toBeUndefined();
    expect(fixture.shownQuickPicks).toEqual([]);
  });

  describe("/clear", () => {
    it("starts a new conversation under the same identity and keeps the model in use", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.rename(sessionId, "Named work");
      await registry.setModel(sessionId, "fake", "other");
      await registry.setThinkingLevel(sessionId, "high");
      const firstFile = view(sessionId).sessionFile;
      await fixture.waitFor(() => fixture.persistedSessions().some((record) => record.sessionFile === firstFile));

      await registry.sendPrompt(sessionId, " /clear ", []);

      const cleared = view(sessionId);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(userPrompts(cleared)).toEqual([]);
      expect(notices(cleared)).toEqual([expect.stringContaining("Conversation cleared. The earlier conversation stays in Pi's session history")]);
      expect(cleared).toMatchObject({
        title: "New session", status: "ready", historyStatus: "loaded", thinkingLevel: "high",
        model: { provider: "fake", id: "other" },
      });
      expect(cleared.sessionFile).not.toBe(firstFile);
      expect(cleared.composerSeed).toBeUndefined();

      // No file backs the new conversation yet, so restart metadata must not name it.
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual([]);
      await fixture.converse(sessionId, "second");
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual([expect.objectContaining({ id: sessionId, sessionFile: view(sessionId).sessionFile })]);
      expect(userPrompts(view(sessionId))).toEqual(["second"]);
      expect(fixture.errors).toEqual([]);
    });

    it("is not auto-discarded like an unused new session when the sidebar moves on", async () => {
      const fixture = await host();
      const { registry } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "/clear", []);

      const other = await fixture.startSession();

      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId, other]);
    });

    it("refuses while a response is running and leaves the conversation alone", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);

      await expect(registry.sendPrompt(sessionId, "/clear", [], "steer")).rejects.toThrow("Stop the current response before clearing the conversation.");

      expect(view(sessionId)).toMatchObject({ isStreaming: true, queuedSteers: [], queuedFollowUps: [] });
      expect(userPrompts(view(sessionId))).toEqual(["first", "hold"]);
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toHaveLength(1);
    });

    it("keeps everything when a Pi extension vetoes the new session", async () => {
      const fixture = await host(["--veto-new-session"]);
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      const file = view(sessionId).sessionFile;

      await expect(registry.clearConversation(sessionId)).resolves.toEqual({ cancelled: true });

      expect(userPrompts(view(sessionId))).toEqual(["first"]);
      expect(view(sessionId).sessionFile).toBe(file);
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual([expect.objectContaining({ id: sessionId, sessionFile: file })]);
    });

    it("changes nothing, restart metadata included, while Pi has not committed", async () => {
      // Pi holds the request, as it does while an extension asks the user, then vetoes.
      const fixture = await host(["--hold-new-session", "--veto-new-session"]);
      const { registry, view } = fixture;
      const cleared = await fixture.startSession();
      await fixture.converse(cleared, "first in A");
      const other = await fixture.startSession();
      await fixture.converse(other, "first in B");
      const file = view(cleared).sessionFile;

      const clearing = registry.clearConversation(cleared);
      await new Promise((resolve) => setImmediate(resolve));

      // Requests that would land around the switch wait for it.
      await expect(registry.setModel(cleared, "fake", "other")).rejects.toThrow("Wait for the conversation to finish clearing.");
      await expect(registry.sendPrompt(cleared, "too early", [])).rejects.toThrow("Wait for the conversation to finish clearing.");
      await expect(registry.sendPrompt(cleared, "/btw too early", [])).rejects.toThrow("Wait for the conversation to finish clearing.");
      await expect(registry.clearConversation(cleared)).rejects.toThrow("Finish the current session-tree interaction first.");
      // An unrelated save in that window still describes the Session as it is.
      await registry.rename(other, "Renamed B");
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual(expect.arrayContaining([expect.objectContaining({ id: cleared, sessionFile: file })]));

      await registry.refreshCommands(cleared);
      await expect(clearing).resolves.toEqual({ cancelled: true });

      expect(userPrompts(view(cleared))).toEqual(["first in A"]);
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual(expect.arrayContaining([expect.objectContaining({ id: cleared, sessionFile: file })]));
      await registry.setModel(cleared, "fake", "other");
      expect(view(cleared).model).toMatchObject({ id: "other" });
    });

    it("commits whenever Pi answers, however long that takes, and reads the new conversation from its start", async () => {
      const fixture = await host(["--hold-new-session"]);
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");

      const clearing = registry.sendPrompt(sessionId, "/clear", []);
      await new Promise((resolve) => setImmediate(resolve));
      expect(userPrompts(view(sessionId))).toEqual(["first"]);
      await registry.refreshCommands(sessionId);
      await clearing;

      expect(userPrompts(view(sessionId))).toEqual([]);
      // The fake rejects a cursor from the earlier conversation, as Pi does.
      await fixture.converse(sessionId, "second");
      expect(userPrompts(view(sessionId))).toEqual(["second"]);
      expect(view(sessionId).historyStatus).toBe("loaded");
      expect(fixture.errors).toEqual([]);
    });

    it("stays a new, unsaved conversation when loading it fails after Pi committed", async () => {
      const fixture = await host(["--fail-state-after-new-session"]);
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.rename(sessionId, "Named work");
      const earlierFile = view(sessionId).sessionFile;
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual([expect.objectContaining({ id: sessionId, sessionFile: earlierFile })]);

      await expect(registry.sendPrompt(sessionId, "/clear", [])).rejects.toThrow("transient get_state failure");

      expect(view(sessionId)).toMatchObject({ title: "New session", historyStatus: "failed" });
      expect(userPrompts(view(sessionId))).toEqual([]);
      expect(notices(view(sessionId))).toEqual([expect.stringContaining("Unable to load the new conversation")]);
      // The earlier file is no longer this entry's conversation: it is not saved as such...
      const bystander = await fixture.startSession();
      await registry.rename(bystander, "Any later save");
      await registry.flushPersistence();
      expect(fixture.persistedSessions().map((record) => record.id)).toEqual([bystander]);
      // ...and a restart does not reopen what the user cleared.
      await registry.retrySession(sessionId);
      await fixture.waitFor(() => view(sessionId).status === "ready" && view(sessionId).sessionFile !== undefined);
      expect(view(sessionId).sessionFile).not.toBe(earlierFile);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId, bystander]);
    });

    it("takes a pending side question with the conversation it was about", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "/btw never-answer", []);
      expect(view(sessionId).sideQuestion).toMatchObject({ status: "pending" });

      await registry.sendPrompt(sessionId, "/clear", []);

      expect(view(sessionId).sideQuestion).toBeUndefined();
      expect(userPrompts(view(sessionId))).toEqual([]);
    });

    it("confirms before discarding a temporary session's only copy", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession(true);
      await fixture.converse(sessionId, "unsaved");

      fixture.answerWarningDialogs(undefined);
      await registry.sendPrompt(sessionId, "/clear", []);
      expect(fixture.warningDialogs).toEqual([expect.stringContaining("permanently discard its conversation")]);
      expect(userPrompts(view(sessionId))).toEqual(["unsaved"]);

      fixture.answerWarningDialogs("first-button");
      await registry.sendPrompt(sessionId, "/clear", []);
      expect(userPrompts(view(sessionId))).toEqual([]);
      expect(notices(view(sessionId))).toEqual(["Conversation cleared."]);
      expect(view(sessionId).isEphemeral).toBe(true);
    });

    it("leaves text after the command for Pi and rejects attachments", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "/clear the cache directory");
      expect(userPrompts(view(sessionId))).toEqual(["/clear the cache directory"]);

      const image = { id: "i", name: "i.png", mimeType: "image/png" as const, data: "AAAA", size: 3 };
      await expect(registry.sendPrompt(sessionId, "/clear", [image])).rejects.toThrow("/clear does not support image attachments.");
      expect(userPrompts(view(sessionId))).toEqual(["/clear the cache directory"]);
    });
  });

  describe("/rewind", () => {
    it("returns to before the chosen prompt and hands that prompt back to the Composer", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      for (const text of ["first", "second", "third"]) await fixture.converse(sessionId, text);

      fixture.quickPicks.push(
        (items) => items.find((item) => item.label.includes("second")),
        (items) => items[0],
      );
      await registry.sendPrompt(sessionId, "/rewind", []);

      expect(fixture.shownQuickPicks).toEqual([
        { title: "Rewind conversation", labels: ["$(history) third", "$(history) second", "$(history) first"] },
        expect.objectContaining({ title: "Leave current branch" }),
      ]);
      expect(userPrompts(view(sessionId))).toEqual(["first"]);
      // The seed survives the /rewind submission that produced it.
      expect(view(sessionId).composerSeed).toMatchObject({ text: "second", images: [] });
      expect(fixture.errors).toEqual([]);

      await fixture.converse(sessionId, "second, revised");
      expect(userPrompts(view(sessionId))).toEqual(["first", "second, revised"]);
      expect(view(sessionId).composerSeed).toBeUndefined();
    });

    it("changes nothing when either picker is dismissed", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      for (const text of ["first", "second"]) await fixture.converse(sessionId, text);

      await expect(registry.rewind(sessionId)).resolves.toEqual({ cancelled: true });
      fixture.quickPicks.push((items) => items[0]);
      await expect(registry.rewind(sessionId)).resolves.toEqual({ cancelled: true });

      expect(userPrompts(view(sessionId))).toEqual(["first", "second"]);
      expect(view(sessionId).composerSeed).toBeUndefined();
    });

    it("explains why it cannot run instead of opening an empty or stale picker", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await expect(registry.sendPrompt(sessionId, "/rewind", [])).rejects.toThrow("This conversation has no earlier prompt to rewind to.");

      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      await expect(registry.sendPrompt(sessionId, "/rewind", [], "followUp")).rejects.toThrow("Wait for the current Pi operation to finish");
      expect(fixture.shownQuickPicks).toEqual([]);
      expect(view(sessionId).queuedFollowUps).toEqual([]);
    });
  });

  describe("/btw", () => {
    it("answers from the conversation without adding to it or promoting a new session", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();

      await registry.sendPrompt(sessionId, "/btw   what is this repo?", []);
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "answered");

      expect(view(sessionId).sideQuestion).toMatchObject({
        question: "what is this repo?",
        answer: 'Answer to "what is this repo?" from 0 entries',
        model: "fake/default",
        usage: { input: 1200, output: 34, cacheRead: 1000 },
      });
      expect(view(sessionId).conversationItems).toEqual([]);
      // A side question is not a first prompt: the unused session is still replaceable.
      await registry.flushPersistence();
      expect(fixture.persistedSessions()).toEqual([]);
    });

    it("answers while the agent is busy and never queues the question as a prompt", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);

      await registry.sendPrompt(sessionId, "/btw slow-answer please", [], "steer");
      expect(view(sessionId).sideQuestion).toMatchObject({ status: "pending", question: "slow-answer please" });
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "answered");

      expect(view(sessionId).sideQuestion?.answer).toBe('Answer to "slow-answer please" from 2 entries while busy');
      expect(view(sessionId)).toMatchObject({ isStreaming: true, queuedSteers: [], queuedFollowUps: [] });
      await registry.abort(sessionId);
      await fixture.waitFor(() => !view(sessionId).isStreaming);
      expect(userPrompts(view(sessionId))).toEqual(["first", "hold"]);
    });

    it("shows a provider failure or a missing result on the card, not as a prompt error", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();

      await registry.sendPrompt(sessionId, "/btw provider-failure", []);
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "failed");
      expect(view(sessionId).sideQuestion?.error).toBe("429 rate limited");

      await registry.sendPrompt(sessionId, "/btw no-result", []);
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "failed" && view(sessionId).sideQuestion?.question === "no-result");
      expect(view(sessionId).sideQuestion?.error).toBe("Pi did not return an answer to the side question.");
      expect(fixture.errors).toEqual([]);
    });

    it("drops an answer that arrives after its card was dismissed or replaced", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();

      // The fake writes a held answer at once and delivers it just before the next one.
      await registry.sendPrompt(sessionId, "/btw held-answer one", []);
      const first = view(sessionId).sideQuestion!.id;
      registry.dismissSideQuestion(sessionId, "another-card");
      expect(view(sessionId).sideQuestion?.id).toBe(first);
      registry.dismissSideQuestion(sessionId, first);
      expect(view(sessionId).sideQuestion).toBeUndefined();

      await registry.sendPrompt(sessionId, "/btw held-answer two", []);
      await registry.sendPrompt(sessionId, "/btw three", []);
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "answered");
      // All three answers have reached the Host; only the card still shown took one.
      await fixture.sideQuestionAnswersConsumed();
      expect(view(sessionId).sideQuestion).toMatchObject({ question: "three", answer: expect.stringContaining('"three"') as string });
    });

    it("marks an answer the model did not finish", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();

      await registry.sendPrompt(sessionId, "/btw cut-off", []);
      await fixture.waitFor(() => view(sessionId).sideQuestion?.status === "answered");

      expect(view(sessionId).sideQuestion).toMatchObject({ incomplete: "length" });
    });

    it("rejects an empty question and attachments before asking Pi", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      const image = { id: "i", name: "i.png", mimeType: "image/png" as const, data: "AAAA", size: 3 };

      await expect(registry.sendPrompt(sessionId, "/btw", [])).rejects.toThrow("Type a question after /btw.");
      await expect(registry.sendPrompt(sessionId, "/btw look", [image])).rejects.toThrow("/btw does not support image attachments.");
      expect(view(sessionId).sideQuestion).toBeUndefined();
    });

    it("fails a pending question when its process stops", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "/btw never-answer", []);
      expect(view(sessionId).sideQuestion).toMatchObject({ status: "pending" });

      await registry.retrySession(sessionId);

      expect(view(sessionId).sideQuestion).toMatchObject({ status: "failed", error: "The session stopped before the answer arrived." });
    });
  });

  describe("a Session created for its own presentation", () => {
    it("keeps the sidebar's unused session and selection, and inherits the source directory without asking", async () => {
      const fixture = await host();
      const { registry } = fixture;
      const sidebar = await fixture.startSession();
      fixture.discoveries.length = 0;
      const order: string[] = [];

      const created = await registry.createSession(false, {
        selection: "preserve-sidebar-selection",
        workingDirectoryOf: sidebar,
        onRegistered: (sessionId) => { order.push(`registered:${registry.sessionView(sessionId)?.status}`); },
      });

      expect(order).toEqual(["registered:stopped"]);
      expect(registry.activeSessionId).toBe(sidebar);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sidebar, created]);
      expect(fixture.view(created!)).toMatchObject({ cwd: fixture.view(sidebar).cwd, status: "ready" });
      expect(fixture.shownQuickPicks).toEqual([]);
    });

    it("selects the new session when the sidebar shows nothing", async () => {
      const fixture = await host();
      const created = await fixture.registry.createSession(false, { selection: "preserve-sidebar-selection" });
      expect(fixture.registry.activeSessionId).toBe(created);
    });

    it("still starts the session when its presentation cannot open, and reports that failure", async () => {
      const fixture = await host();
      const { registry } = fixture;
      const onRegistered = vi.fn(() => { throw new Error("panel failed"); });

      await expect(registry.createSession(false, { selection: "preserve-sidebar-selection", onRegistered })).rejects.toThrow("panel failed");

      const [session] = registry.snapshot().sessions;
      expect(session).toMatchObject({ status: "ready" });
      // Later creations are not blocked by the failed one.
      await expect(registry.createSession()).resolves.toEqual(expect.any(String));
    });
  });
});
