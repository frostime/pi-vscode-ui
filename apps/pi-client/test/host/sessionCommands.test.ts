import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
      "new:frostpi", "reload:frostpi", "name:frostpi", "alias:frostpi", "btw:frostpi", "visible:extension",
    ]);
  });

  it("leaves a command it cannot answer to the runtime instead of intercepting it", async () => {
    // A Host without the bundled adapters: the same text may be the user's own Pi command.
    const fixture = await host([], { adapters: false });
    const { view } = fixture;
    const sessionId = await fixture.startSession();
    expect(view(sessionId).commands.map((command) => command.name)).toEqual(["new", "name", "alias", "visible"]);

    await fixture.converse(sessionId, "/btw is this mine?");
    await fixture.converse(sessionId, "/reload");

    expect(userPrompts(view(sessionId))).toEqual(["/btw is this mine?", "/reload"]);
    expect(view(sessionId).sideQuestion).toBeUndefined();
    expect(fixture.shownQuickPicks).toEqual([]);
  });

  it("stops offering and intercepting a command whose adapter did not load in this process", async () => {
    // The adapters were passed to Pi, but its command list shows it loaded neither.
    const fixture = await host(["--adapters-not-loaded"]);
    const { view } = fixture;
    const sessionId = await fixture.startSession();
    expect(view(sessionId).commands.map((command) => command.name)).toEqual(["new", "name", "alias", "visible"]);

    await fixture.converse(sessionId, "/btw is this mine?");
    await fixture.converse(sessionId, "/reload");

    expect(userPrompts(view(sessionId))).toEqual(["/btw is this mine?", "/reload"]);
    expect(view(sessionId).sideQuestion).toBeUndefined();
    expect(fixture.shownQuickPicks).toEqual([]);
  });

  describe("/name, /alias and /reload", () => {
    it("renames from the Composer, with or without a name, also while a turn runs", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);

      await registry.sendPrompt(sessionId, "/alias  Parser   work ", [], "steer");
      expect(view(sessionId).title).toBe("Parser   work");
      fixture.inputBoxes.push("From the input box");
      await registry.sendPrompt(sessionId, "/name", []);
      expect(view(sessionId).title).toBe("From the input box");
      // Dismissing the input box changes nothing.
      await registry.sendPrompt(sessionId, "/name", []);
      expect(view(sessionId).title).toBe("From the input box");

      expect(view(sessionId)).toMatchObject({ isStreaming: true, queuedSteers: [], queuedFollowUps: [] });
      expect(userPrompts(view(sessionId))).toEqual(["first", "hold"]);
      await registry.abort(sessionId);
    });

    it("reloads Pi's resources in place and reads the command list again", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");

      await registry.sendPrompt(sessionId, "/reload", []);

      expect(view(sessionId).commands.map((command) => command.name)).toContain("added-by-reload");
      expect(notices(view(sessionId))).toEqual([expect.stringContaining("Reloaded Pi's extensions")]);
      expect(userPrompts(view(sessionId))).toEqual(["first"]);

      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      await expect(registry.sendPrompt(sessionId, "/reload", [], "steer")).rejects.toThrow("Stop the current response before reloading.");
      await registry.abort(sessionId);
    });
  });

  describe("/new", () => {
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

      await registry.sendPrompt(sessionId, " /new ", []);

      const cleared = view(sessionId);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(userPrompts(cleared)).toEqual([]);
      expect(notices(cleared)).toEqual([expect.stringContaining("New conversation started. The earlier conversation stays in Pi's session history")]);
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
      await registry.sendPrompt(sessionId, "/new", []);

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

      await expect(registry.sendPrompt(sessionId, "/new", [], "steer")).rejects.toThrow("Stop the current response before starting a new conversation.");

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

      await expect(registry.startNewConversation(sessionId)).resolves.toEqual({ cancelled: true });

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

      const clearing = registry.startNewConversation(cleared);
      await new Promise((resolve) => setImmediate(resolve));

      // Requests that would land around the switch wait for it.
      await expect(registry.setModel(cleared, "fake", "other")).rejects.toThrow("Wait for the new conversation to finish starting.");
      await expect(registry.sendPrompt(cleared, "too early", [])).rejects.toThrow("Wait for the new conversation to finish starting.");
      await expect(registry.sendPrompt(cleared, "/btw too early", [])).rejects.toThrow("Wait for the new conversation to finish starting.");
      await expect(registry.startNewConversation(cleared)).rejects.toThrow("Finish the current session-tree interaction first.");
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

      const clearing = registry.sendPrompt(sessionId, "/new", []);
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

      await expect(registry.sendPrompt(sessionId, "/new", [])).rejects.toThrow("transient get_state failure");

      expect(view(sessionId)).toMatchObject({ title: "New session", historyStatus: "failed" });
      expect(userPrompts(view(sessionId))).toEqual([]);
      expect(notices(view(sessionId))).toEqual([expect.stringContaining("Unable to load the new conversation")]);
      // The earlier file is no longer this entry's conversation: it is not saved as such...
      const bystander = await fixture.startSession();
      await registry.rename(bystander, "Any later save");
      await registry.flushPersistence();
      expect(fixture.persistedSessions().map((record) => record.id)).toEqual([bystander]);
      // ...and a restart does not reopen the conversation the user left.
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

      await registry.sendPrompt(sessionId, "/new", []);

      expect(view(sessionId).sideQuestion).toBeUndefined();
      expect(userPrompts(view(sessionId))).toEqual([]);
    });

    it("confirms before discarding a temporary session's only copy", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession(true);
      await fixture.converse(sessionId, "unsaved");

      fixture.answerWarningDialogs(undefined);
      await registry.sendPrompt(sessionId, "/new", []);
      expect(fixture.warningDialogs).toEqual([expect.stringContaining("permanently discard the current one")]);
      expect(userPrompts(view(sessionId))).toEqual(["unsaved"]);

      fixture.answerWarningDialogs("first-button");
      await registry.sendPrompt(sessionId, "/new", []);
      expect(userPrompts(view(sessionId))).toEqual([]);
      expect(notices(view(sessionId))).toEqual(["New conversation started."]);
      expect(view(sessionId).isEphemeral).toBe(true);
    });

    it("leaves text after the command for Pi and rejects attachments", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "/new feature branch");
      expect(userPrompts(view(sessionId))).toEqual(["/new feature branch"]);

      const image = { id: "i", name: "i.png", mimeType: "image/png" as const, data: "AAAA", size: 3 };
      await expect(registry.sendPrompt(sessionId, "/new", [image])).rejects.toThrow("/new does not support image attachments.");
      expect(userPrompts(view(sessionId))).toEqual(["/new feature branch"]);
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


  describe("Fork during a reply", () => {
    it.each(["first prompt", "explicit rename"] as const)("keeps a busy Fork provisional until its %s", async (use) => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await fixture.converse(sessionId, "second");
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      const sourceFile = view(sessionId).sessionFile;
      const second = view(sessionId).conversationItems.flatMap((item) => item.type === "turn" && item.userMessage?.blocks.some((block) => block.type === "text" && block.text === "second") ? [item.userMessage.sourceEntryId] : [])[0]!;

      const result = await registry.forkMessage(sessionId, second, "preserve-sidebar-selection");

      expect(result).toEqual({ cancelled: false, forkSessionId: expect.any(String) as string });
      const fork = view(result.forkSessionId!);
      expect(fork).toMatchObject({ title: "Fork: New session", status: "ready", composerSeed: { text: "second" } });
      expect(userPrompts(fork)).toEqual(["first"]);
      expect(fork.sessionFile).not.toBe(sourceFile);
      // The source is still running its reply, in its own process and file.
      expect(view(sessionId)).toMatchObject({ isStreaming: true, sessionFile: sourceFile });
      expect(registry.activeSessionId).toBe(sessionId);
      await registry.flushPersistence();
      expect(fixture.persistedSessions().map((record) => record.id)).toEqual([sessionId]);
      expect(existsSync(fork.sessionFile!)).toBe(true);

      const forkId = result.forkSessionId!;
      if (use === "first prompt") await fixture.converse(forkId, "continue the fork");
      else await registry.rename(forkId, "Keep this fork");
      await registry.flushPersistence();
      expect(fixture.persistedSessions().map((record) => record.id)).toEqual([sessionId, forkId]);

      await registry.abort(sessionId);
      await fixture.waitFor(() => !view(sessionId).isStreaming);
      expect(userPrompts(view(sessionId))).toEqual(["first", "second", "hold"]);
    });

    it("loads a large session's full history in the second process before forking", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await fixture.converse(sessionId, "second");
      // Above 8 MiB the ordinary load defers; the Fork's own process must not stop there.
      for (let index = 0; index < 12; index += 1) await fixture.converse(sessionId, `bulk ${index}`);
      // Reopened, the source defers its history too, until the user loads it.
      await registry.retrySession(sessionId);
      await fixture.waitFor(() => view(sessionId).status === "ready" && view(sessionId).historyStatus === "deferred");
      await registry.loadHistory(sessionId);
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      const second = view(sessionId).conversationItems.flatMap((item) => item.type === "turn" && item.userMessage?.blocks.some((block) => block.type === "text" && block.text === "second") ? [item.userMessage.sourceEntryId] : [])[0]!;

      const result = await registry.forkMessage(sessionId, second, "preserve-sidebar-selection");

      expect(result).toEqual({ cancelled: false, forkSessionId: expect.any(String) as string });
      expect(view(result.forkSessionId!)).toMatchObject({ status: "ready", historyStatus: "loaded", composerSeed: { text: "second" } });
      expect(userPrompts(view(result.forkSessionId!))).toEqual(["first"]);
      expect(view(sessionId).isStreaming).toBe(true);
      await registry.abort(sessionId);
    }, 30_000);

    /** A busy Session whose Fork's own process waits before forking, until `release`. */
    async function heldFork(fixture: Awaited<ReturnType<typeof host>>) {
      const { registry, view } = fixture;
      const trashed: string[] = [];
      fixture.host.moveToTrash = (path) => { trashed.push(path); return rm(path); };
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await fixture.converse(sessionId, "second");
      const sourceFile = view(sessionId).sessionFile!;
      const entryOf = (text: string) => view(sessionId).conversationItems.flatMap((item) => item.type === "turn" && item.userMessage?.blocks.some((block) => block.type === "text" && block.text === text) ? [item.userMessage.sourceEntryId] : [])[0];
      const second = entryOf("second")!;
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      const fork = registry.forkMessage(sessionId, second, "preserve-sidebar-selection");
      await fixture.waitFor(() => existsSync(join(fixture.directory, "fork-waiting")), 10_000);
      return { sessionId, sourceFile, trashed, fork, release: () => writeFile(join(fixture.directory, "fork-release"), "1") };
    }

    it("keeps an unfinished Fork out of the collection, so deleting cannot reach the source's file through it", async () => {
      const fixture = await host(["--hold-fork"]);
      const { registry, view } = fixture;
      const { sessionId, sourceFile, trashed, fork, release } = await heldFork(fixture);

      // The Fork's process has the source's file open; it is not a Session anyone can act on.
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      await expect(registry.deleteSession(sessionId)).rejects.toThrow("Wait for the Fork of this session to finish or cancel it first.");
      expect(trashed).toEqual([]);
      expect(existsSync(sourceFile)).toBe(true);

      await release();
      const result = await fork;
      expect(result).toEqual({ cancelled: false, forkSessionId: expect.any(String) as string });
      const forkFile = view(result.forkSessionId!).sessionFile!;
      expect(forkFile).not.toBe(sourceFile);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId, result.forkSessionId]);

      // Once complete, deleting the Fork hands only its own file to the trash.
      await registry.deleteSession(result.forkSessionId!);
      expect(trashed).toEqual([forkFile]);
      expect(existsSync(sourceFile)).toBe(true);
      expect(view(sessionId).isStreaming).toBe(true);
      await registry.abort(sessionId);
    }, 20_000);

    it("cancels an unfinished Fork from a busy Session without touching any file", async () => {
      const fixture = await host(["--hold-fork"]);
      const { registry, view } = fixture;
      const { sessionId, sourceFile, trashed, fork } = await heldFork(fixture);

      await registry.cancelFork(sessionId);

      await expect(fork).resolves.toEqual({ cancelled: true });
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(trashed).toEqual([]);
      expect(existsSync(sourceFile)).toBe(true);
      expect(view(sessionId).isStreaming).toBe(true);
      await expect(registry.cancelFork(sessionId)).rejects.toThrow("No Fork operation is active for this session.");
      await registry.abort(sessionId);
      await fixture.waitFor(() => !view(sessionId).isStreaming);
      expect(userPrompts(view(sessionId))).toEqual(["first", "second", "hold"]);
    }, 20_000);

    it("leaves nothing behind when the Fork fails", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);

      await expect(registry.forkMessage(sessionId, "no-such-entry")).rejects.toThrow();

      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(view(sessionId).isStreaming).toBe(true);
      await registry.abort(sessionId);
    });
  });

  describe("stop and delete", () => {
    it("stops a Session's Pi process but keeps it listed, and starts it again from its file", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "first");
      const file = view(sessionId).sessionFile!;

      await registry.stopSession(sessionId);

      expect(view(sessionId).status).toBe("stopped");
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([sessionId]);
      expect(fixture.persistedSessions()).toEqual([expect.objectContaining({ id: sessionId, sessionFile: file })]);
      // Stopping again does nothing.
      await registry.stopSession(sessionId);

      await fixture.converse(sessionId, "second");
      expect(view(sessionId).sessionFile).toBe(file);
      expect(userPrompts(view(sessionId))).toEqual(["first", "second"]);
    });

    it("warns about discarding queued messages before stopping a running reply", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const sessionId = await fixture.startSession();
      await registry.sendPrompt(sessionId, "hold", []);
      await fixture.waitFor(() => view(sessionId).isStreaming);
      await registry.sendPrompt(sessionId, "follow up", [], "followUp");
      expect(view(sessionId).queuedFollowUps).toHaveLength(1);

      fixture.answerWarningDialogs(undefined);
      await registry.stopSession(sessionId);
      expect(fixture.warningDialogs.at(-1)).toContain("Stopping this session's Pi process will stop its active response");
      expect(fixture.warningDialogs.at(-1)).toContain("Any queued messages will be discarded.");
      expect(view(sessionId).isStreaming).toBe(true);
      expect(view(sessionId).queuedFollowUps).toHaveLength(1);

      fixture.answerWarningDialogs("first-button");
      await registry.stopSession(sessionId);
      expect(view(sessionId)).toMatchObject({ status: "stopped", queuedFollowUps: [] });
    });

    it("neither stops nor deletes a temporary Session, which could not start again", async () => {
      const fixture = await host();
      const sessionId = await fixture.startSession(true);
      await expect(fixture.registry.stopSession(sessionId)).rejects.toThrow("Close it instead");
      await expect(fixture.registry.deleteSession(sessionId)).rejects.toThrow("Close it instead");
      expect(fixture.view(sessionId).status).toBe("ready");
    });

    it("deletes the Session with its Pi file after confirmation, and keeps both when declined", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const kept = await fixture.startSession();
      await fixture.converse(kept, "keep me");
      const sessionId = await fixture.startSession();
      await fixture.converse(sessionId, "delete me");
      const file = view(sessionId).sessionFile!;
      expect(existsSync(file)).toBe(true);

      fixture.answerWarningDialogs(undefined);
      await registry.deleteSession(sessionId);
      expect(fixture.warningDialogs.at(-1)).toContain(`permanently deleted: ${file}`);
      expect(existsSync(file)).toBe(true);
      expect(view(sessionId).status).toBe("ready");

      fixture.answerWarningDialogs("first-button");
      await registry.deleteSession(sessionId);
      expect(existsSync(file)).toBe(false);
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([kept]);
      expect(registry.activeSessionId).toBe(kept);
      expect(fixture.persistedSessions().map((session) => session.id)).toEqual([kept]);
      expect(existsSync(view(kept).sessionFile!)).toBe(true);
    });

    it("moves the file to the host's trash, and asks before deleting permanently when that fails", async () => {
      const fixture = await host();
      const { registry, view } = fixture;
      const trashed: string[] = [];
      fixture.host.moveToTrash = (path) => { trashed.push(path); return rm(path); };
      const first = await fixture.startSession();
      await fixture.converse(first, "one");
      const firstFile = view(first).sessionFile!;

      await registry.deleteSession(first);
      expect(fixture.warningDialogs.at(-1)).toContain("moved to the trash");
      expect(trashed).toEqual([firstFile]);
      expect(existsSync(firstFile)).toBe(false);

      fixture.host.moveToTrash = () => Promise.reject(new Error("no trash here"));
      const second = await fixture.startSession();
      await fixture.converse(second, "two");
      const secondFile = view(second).sessionFile!;
      let dialogs = 0;
      fixture.host.window.showWarningDialog = (message, buttons) => {
        fixture.warningDialogs.push(message);
        dialogs += 1;
        // Confirm the deletion, then decline the permanent fallback.
        return Promise.resolve(dialogs === 1 ? buttons[0] : undefined);
      };
      await expect(registry.deleteSession(second)).rejects.toThrow("stopped but not deleted");
      expect(fixture.warningDialogs.at(-1)).toContain("could not be moved to the trash (no trash here)");
      expect(existsSync(secondFile)).toBe(true);
      expect(view(second).status).toBe("stopped");
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

    it("can be temporary: never saved, and kept when the sidebar moves on", async () => {
      const fixture = await host();
      const { registry } = fixture;
      const sidebar = await fixture.startSession();

      const temporary = await registry.createSession(true, { selection: "preserve-sidebar-selection", workingDirectoryOf: sidebar });

      expect(registry.activeSessionId).toBe(sidebar);
      expect(fixture.view(temporary!)).toMatchObject({ isEphemeral: true, status: "ready" });
      expect(fixture.view(temporary!).sessionFile).toBeUndefined();
      // The sidebar replaces its own unused session; the temporary one in its tab stays.
      const next = await registry.createSession();
      expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([temporary, next]);
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
