import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HostToWebviewMessage, RestoreQueuedPromptsResult } from "../../src/shared/bridge/hostToWebview.js";
import type { ComposerDraftImageView } from "../../src/shared/model/composerDraftModel.js";
import { queuedRecoveryHost, waitForRecovery } from "../fixtures/queuedRecoveryHost.js";

const image: ComposerDraftImageView = {
  id: "original", name: "pixel.png", mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7nkAAAAASUVORK5CYII=", size: 68,
};
function recoveryResult(messages: HostToWebviewMessage[], id: string): RestoreQueuedPromptsResult | undefined {
  return messages.find((message): message is RestoreQueuedPromptsResult & { bridgeVersion: string } =>
    message.type === "restoreQueuedPromptsResult" && message.requestId === id);
}

function recoveryError(messages: HostToWebviewMessage[], id: string): string {
  const result = recoveryResult(messages, id);
  if (result?.ok !== false) throw new Error(`Expected a correlated recovery failure for ${id}`);
  return result.error;
}

describe("queued recovery through the real Host and child-process path", () => {
  const fixtures: Awaited<ReturnType<typeof queuedRecoveryHost>>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose())); });

  it.each(["pi", "oh-my-pi"] as const)("%s authorizes the source and recovers both queues without ending the active run", async (runtime) => {
    const fixture = await queuedRecoveryHost(runtime, (dir) => ["--recovery-release", join(dir, "release")]);
    fixtures.push(fixture);
    const { registry, sessionId } = fixture;
    const surface = fixture.presentation();
    surface.send({ type: "ready" });
    await registry.sendPrompt(sessionId, "active", []);
    await registry.sendPrompt(sessionId, "steer", [], "steer");
    await registry.sendPrompt(sessionId, "follow-up", [], "followUp");
    surface.send({ type: "restoreQueuedPrompts", sessionId: "other", requestId: "wrong-target", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(surface.messages, "wrong-target") !== undefined);
    expect(recoveryResult(surface.messages, "wrong-target")).toMatchObject({ ok: false });

    surface.send({ type: "restoreQueuedPrompts", sessionId, requestId: "valid", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(surface.messages, "valid") !== undefined);
    expect(recoveryResult(surface.messages, "valid")).toMatchObject({
      ok: true, draftTarget: "webview-merge",
      outcome: { content: { text: "steer\n\nfollow-up", images: [] }, recoveredCount: 2 },
    });
    expect(registry.sessionView(sessionId)).toMatchObject({ isStreaming: true, queuedSteers: [], queuedFollowUps: [] });
    await writeFile(join(fixture.directory, "release"), "1");
    await waitForRecovery(() => registry.sessionView(sessionId)?.isStreaming === false);
    const users = registry.sessionView(sessionId)?.conversationItems.flatMap((item) => item.type === "turn" && item.userMessage ? [item.userMessage] : []);
    expect(users).toHaveLength(1);
    expect(users?.[0]?.blocks).toEqual([{ type: "text", text: "active" }]);
    expect(fixture.errors).toEqual([]);
  });

  it("returns actual OMP images but rejects Pi image recovery without removing the input", async () => {
    for (const runtime of ["pi", "oh-my-pi"] as const) {
      const fixture = await queuedRecoveryHost(runtime);
      fixtures.push(fixture);
      const { registry, sessionId } = fixture;
      const surface = fixture.presentation();
      await registry.sendPrompt(sessionId, "active", []);
      await registry.sendPrompt(sessionId, "image", [image], "steer");
      surface.send({ type: "restoreQueuedPrompts", sessionId, requestId: "images", draftImageCount: 0 });
      await waitForRecovery(() => recoveryResult(surface.messages, "images") !== undefined);
      const result = recoveryResult(surface.messages, "images");
      if (runtime === "pi") {
        expect(recoveryError(surface.messages, "images")).toContain("cannot return queued images");
        expect(registry.sessionView(sessionId)?.queuedSteers).toHaveLength(1);
      } else {
        expect(result).toMatchObject({ ok: true, draftTarget: "webview-merge", outcome: {
          certainty: "confirmed", content: { text: "image", images: [expect.objectContaining({ data: image.data, mimeType: image.mimeType })] },
        } });
        expect(registry.sessionView(sessionId)?.queuedSteers).toEqual([]);
      }
    }
  });

  it("keeps Host draft authority after tab closure and merges once into newer Sidebar edits", async () => {
    const fixture = await queuedRecoveryHost("pi", (dir) => ["--recovery-clear-release", join(dir, "clear")]);
    fixtures.push(fixture);
    const { registry, drafts, sessionId } = fixture;
    const sidebar = fixture.presentation();
    sidebar.send({ type: "ready" });
    drafts.beginHandoff(sessionId, { revision: 5, text: "old draft", images: [] });
    const panel = fixture.presentation({ kind: "panel", sessionId });
    panel.send({ type: "ready" });
    await registry.sendPrompt(sessionId, "active", []);
    await registry.sendPrompt(sessionId, "recover me", [], "steer");
    panel.send({ type: "restoreQueuedPrompts", sessionId, requestId: "panel-recovery", draftImageCount: 0 });
    await waitForRecovery(() => drafts.hasPendingRecovery(sessionId));
    panel.send({ type: "restoreQueuedPrompts", sessionId, requestId: "duplicate", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(panel.messages, "duplicate") !== undefined);
    expect(recoveryResult(panel.messages, "duplicate")).toMatchObject({ ok: false });
    expect(drafts.hasPendingRecovery(sessionId)).toBe(true);
    panel.close();
    sidebar.send({ type: "updateComposerDraft", sessionId, draft: {
      revision: 6, text: "typed after close", imageIds: [], addedImages: [],
    } });
    await waitForRecovery(() => drafts.get(sessionId).text === "typed after close");

    sidebar.send({ type: "sendPrompt", sessionId, requestId: "competing-send", text: "typed after close", images: [], draftRevision: 6, streamingBehavior: "steer" });
    await waitForRecovery(() => sidebar.messages.some((message) => message.type === "promptResult" && message.requestId === "competing-send"));
    expect(sidebar.messages).toContainEqual(expect.objectContaining({ type: "promptResult", requestId: "competing-send", ok: false }));
    expect(drafts.get(sessionId).text).toBe("typed after close");
    await writeFile(join(fixture.directory, "clear"), "1");
    await waitForRecovery(() => drafts.get(sessionId).text === "recover me\n\ntyped after close" && !drafts.hasPendingRecovery(sessionId));
    expect(sidebar.messages.filter((message) => message.type === "draftReplacement").at(-1)?.draft.text).toBe("recover me\n\ntyped after close");
    expect(sidebar.messages.some((message) => message.type === "restoreQueuedPromptsResult")).toBe(false);
    expect(registry.sessionView(sessionId)?.isStreaming).toBe(true);
    expect(fixture.errors).toEqual([]);
  });

  it("rejects recovery at the Runtime boundary during compaction, then recovers the unchanged queue", async () => {
    const fixture = await queuedRecoveryHost("pi", (dir) => ["--recovery-compact-release", join(dir, "compact")]);
    fixtures.push(fixture);
    const { registry, sessionId } = fixture;
    const surface = fixture.presentation();
    await registry.sendPrompt(sessionId, "active", []);
    await registry.sendPrompt(sessionId, "still queued", [], "steer");
    const compact = registry.sendPrompt(sessionId, "/compact", []);
    await waitForRecovery(() => registry.sessionView(sessionId)?.isCompacting === true);
    surface.send({ type: "restoreQueuedPrompts", sessionId, requestId: "during-compact", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(surface.messages, "during-compact") !== undefined);
    expect(recoveryError(surface.messages, "during-compact")).toContain("compaction");
    await writeFile(join(fixture.directory, "compact"), "1");
    await compact;
    surface.send({ type: "restoreQueuedPrompts", sessionId, requestId: "after-compact", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(surface.messages, "after-compact") !== undefined);
    expect(recoveryResult(surface.messages, "after-compact")).toMatchObject({ ok: true, outcome: { content: { text: "still queued" } } });
    expect(registry.sessionView(sessionId)?.isStreaming).toBe(true);
  });

  it("uses the latest Host-owned image count instead of trusting the browser's capacity claim", async () => {
    const fixture = await queuedRecoveryHost("oh-my-pi");
    fixtures.push(fixture);
    const { registry, drafts, sessionId } = fixture;
    drafts.beginHandoff(sessionId, { revision: 1, text: "existing", images: Array.from({ length: 12 }, (_, i) => ({ ...image, id: `draft-${i}` })) });
    const panel = fixture.presentation({ kind: "panel", sessionId });
    await registry.sendPrompt(sessionId, "active", []);
    await registry.sendPrompt(sessionId, "image", [image], "steer");
    panel.send({ type: "restoreQueuedPrompts", sessionId, requestId: "capacity", draftImageCount: 0 });
    await waitForRecovery(() => recoveryResult(panel.messages, "capacity") !== undefined);
    expect(recoveryError(panel.messages, "capacity")).toContain("image limit");
    expect(registry.sessionView(sessionId)?.queuedSteers).toHaveLength(1);
    expect(drafts.get(sessionId).text).toBe("existing");
    expect(drafts.get(sessionId).images).toHaveLength(12);
  });
});
