import type { RpcImageContent, RpcRemoveQueuedMessageResult } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import type { WebviewImageInput } from "../../src/shared/bridge/webviewToHost.js";
import { ConversationProjection } from "../../src/core/conversation/ConversationProjection.js";
import { QueuedPromptRecovery } from "../../src/core/sessions/QueuedPromptRecovery.js";

const png: RpcImageContent = {
  type: "image", mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7nkAAAAASUVORK5CYII=",
};
const inputImage: WebviewImageInput = { id: "original", name: "original.png", ...png, mimeType: "image/png", size: Buffer.byteLength(png.data, "base64") };

type Pending = { text: string; images?: RpcImageContent[]; lostResponse?: boolean; imagesDropped?: boolean; label?: string };
class QueueBackend {
  steering: Pending[] = [];
  followUp: Pending[] = [];

  clearQueue() {
    const result = { steering: this.steering.map((p) => p.text), followUp: this.followUp.map((p) => p.text) };
    this.steering = [];
    this.followUp = [];
    return Promise.resolve(result);
  }

  removeOmpQueuedMessage(message: string, queue: "steering" | "followUp"): Promise<RpcRemoveQueuedMessageResult> {
    const pending = this[queue];
    const index = pending.findIndex((p) => p.text === message);
    if (index === -1) return Promise.resolve({ removed: false });
    const [removed] = pending.splice(index, 1);
    if (removed?.lostResponse) throw new Error("Response lost after removal");
    return Promise.resolve({ removed: true, ...(removed?.images ? { images: removed.images } : {}), ...(removed?.imagesDropped ? { imagesDropped: true } : {}) });
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(runtime: "pi" | "oh-my-pi", backend = new QueueBackend(), availability: () => "ready" | "compacting" | "unavailable" = () => "ready") {
  const conversation = new ConversationProjection();
  conversation.appendUserPrompt("active", [], 1);
  conversation.applyEvent({ type: "agent_start" });
  conversation.applyEvent({ type: "message_start", message: { role: "user", content: "active", timestamp: 1 } });
  const recovery = new QueuedPromptRecovery({
    api: backend, runtime, conversation, readAvailability: availability,
    getAttachmentLimits: () => ({ maxImages: 12, maxImageBytes: 10 * 1024 * 1024 }), onChange() {},
  });
  return { recovery, conversation, backend };
}

describe("QueuedPromptRecovery", () => {
  it("waits for admission, recovers both queues without ending the active turn, and rejects duplicate operations", async () => {
    const { recovery, conversation, backend } = setup("pi");
    backend.steering.push({ text: "first" });
    backend.followUp.push({ text: "afterward" });
    conversation.enqueueSteer("first", [], 2);
    conversation.enqueueFollowUp("afterward", [], 3);
    conversation.enqueueSteer("delayed", [], 4);
    const admitted = deferred();
    const submission = recovery.admitQueuedPrompt(async () => {
      await admitted.promise;
      backend.steering.push({ text: "delayed" });
    });
    const operation = recovery.recoverAll();
    expect(recovery.view.state).toBe("recovering");
    await expect(recovery.recoverAll()).rejects.toThrow("already in progress");
    expect(() => recovery.admitQueuedPrompt(() => { backend.steering.push({ text: "unwanted" }); return Promise.resolve(); })).toThrow("Wait for");
    expect(backend.steering.map((p) => p.text)).toEqual(["first"]);
    admitted.resolve();
    await submission;
    const outcome = await operation;

    expect(outcome).toMatchObject({
      certainty: "best-effort", recoveredCount: 3, content: { text: "first\n\ndelayed\n\nafterward", images: [] },
      warnings: ["delivery-uncertain"],
    });
    expect(backend.steering).toEqual([]);
    expect(backend.followUp).toEqual([]);
    expect(conversation.read().queuedSteers).toEqual([]);
    expect(conversation.read().queuedFollowUps).toEqual([]);
    expect(conversation.read().items[0]).toMatchObject({ type: "turn", status: "running" });
  });

  it("rechecks compaction after admission instead of clearing while the operation became unavailable", async () => {
    let compacting = false;
    const { recovery, conversation, backend } = setup("pi", new QueueBackend(), () => compacting ? "compacting" : "ready");
    conversation.enqueueSteer("delayed", [], 2);
    const admitted = deferred();
    const submission = recovery.admitQueuedPrompt(async () => {
      await admitted.promise;
      backend.steering.push({ text: "delayed" });
    });
    const operation = recovery.recoverAll();
    compacting = true;
    admitted.resolve();
    await submission;
    await expect(operation).rejects.toThrow("compaction");
    expect(backend.steering.map((p) => p.text)).toEqual(["delayed"]);
    expect(conversation.read().queuedSteers.map((p) => p.text)).toEqual(["delayed"]);
    expect(recovery.view).toEqual({ state: "unavailable", reason: "compacting" });
  });

  it("refuses Pi image recovery without clearing either queue", async () => {
    const { recovery, conversation, backend } = setup("pi");
    conversation.enqueueFollowUp("image", [inputImage], 2);
    backend.followUp.push({ text: "image", images: [png] });
    expect(recovery.view).toEqual({ state: "unavailable", reason: "images-not-supported" });
    await expect(recovery.recoverAll()).rejects.toThrow("cannot return queued images");
    expect(backend.followUp).toEqual([{ text: "image", images: [png] }]);
    expect(conversation.read().queuedFollowUps).toHaveLength(1);
  });

  it("preserves confirmed OMP text/images when a later response is lost, without retrying another identical input", async () => {
    const { recovery, conversation, backend } = setup("oh-my-pi");
    backend.steering = [
      { text: "same", images: [png], label: "first" },
      { text: "same", lostResponse: true, label: "second" },
      { text: "same", label: "third" },
    ];
    backend.followUp.push({ text: "untouched" });
    conversation.enqueueSteer("same", [inputImage], 2);
    conversation.enqueueSteer("same", [], 3);
    conversation.enqueueSteer("same", [], 4);
    conversation.enqueueFollowUp("untouched", [], 5);
    const outcome = await recovery.recoverAll();

    expect(outcome).toMatchObject({
      certainty: "confirmed", recoveredCount: 1, notRemovedCount: 3,
      content: { text: "same" }, warnings: ["request-failed"],
    });
    expect(outcome.content.images).toEqual([expect.objectContaining({ data: png.data, mimeType: "image/png" })]);
    expect(outcome.content.images[0]?.id).not.toBe(inputImage.id);
    expect(backend.steering.map((p) => p.label)).toEqual(["third"]);
    expect(backend.followUp.map((p) => p.text)).toEqual(["untouched"]);
  });

  it("does not call an unremoved OMP input delivered, and leaves it for its actual user event", async () => {
    const { recovery, conversation, backend } = setup("oh-my-pi");
    conversation.enqueueSteer("already selected", [], 2);
    conversation.enqueueFollowUp("recover me", [], 3);
    backend.followUp.push({ text: "recover me" });
    const outcome = await recovery.recoverAll();
    expect(outcome).toMatchObject({ recoveredCount: 1, notRemovedCount: 1, content: { text: "recover me" }, warnings: ["not-removed"] });
    expect(conversation.read().items).toHaveLength(1);
    conversation.applyEvent({ type: "message_start", message: { role: "user", content: "already selected", timestamp: 2 } });
    expect(conversation.read().items).toHaveLength(2);
    expect(conversation.read().queuedSteers).toEqual([]);
  });

  it("reports dropped OMP images instead of guessing from the local cached attachment", async () => {
    const { recovery, conversation, backend } = setup("oh-my-pi");
    conversation.enqueueSteer("image", [inputImage], 2);
    backend.steering.push({ text: "image", imagesDropped: true });
    const outcome = await recovery.recoverAll();
    expect(outcome.content).toEqual({ text: "image", images: [] });
    expect(outcome.warnings).toEqual(["images-dropped"]);
    expect(backend.steering).toEqual([]);
  });

  it("rejects a completed old-process result before it can mutate the current projection", async () => {
    const backend = new QueueBackend();
    const started = deferred();
    const reply = deferred();
    const clear = backend.clearQueue.bind(backend);
    backend.clearQueue = async () => {
      const result = await clear();
      started.resolve();
      await reply.promise;
      return result;
    };
    const { recovery, conversation } = setup("pi", backend);
    conversation.enqueueSteer("old process", [], 2);
    backend.steering.push({ text: "old process" });
    const operation = recovery.recoverAll();
    await started.promise;
    recovery.dispose();
    reply.resolve();
    await expect(operation).rejects.toThrow("process changed");
    expect(conversation.read().queuedSteers.map((p) => p.text)).toEqual(["old process"]);
    expect(recovery.view.state).toBe("unavailable");
  });
});
