import { randomUUID } from "node:crypto";

import type { PiRpcApi, RpcClearQueueResult, RpcImageContent, RpcRemoveQueuedMessageResult } from "@frostime/pi-rpc";

import type { ComposerDraftImageView } from "../../shared/model/composerDraftModel.js";
import type { QueuedPromptRecoveryOutcome, QueuedPromptRecoveryView, QueuedPromptRecoveryWarning } from "../../shared/model/queuedPromptRecoveryModel.js";
import type { AttachmentLimitsView } from "../../shared/model/sessionViewModel.js";
import { normalizeImageAttachments } from "../attachments/normalizeImageAttachment.js";
import type { RuntimeCompatibility } from "../configuration/runtimeCompatibility.js";
import type { ConversationProjection } from "../conversation/ConversationProjection.js";

interface RecoveryOptions {
  api: Pick<PiRpcApi, "clearQueue" | "removeOmpQueuedMessage">;
  runtime: RuntimeCompatibility;
  conversation: ConversationProjection;
  readAvailability(): "ready" | "compacting" | "unavailable";
  getAttachmentLimits(): AttachmentLimitsView;
  onChange(): void;
}

/** One child process's non-aborting recovery, not a second queue or an agent-turn lock. */
export class QueuedPromptRecovery {
  readonly #options: RecoveryOptions;
  readonly #admissions = new Set<Promise<void>>();
  #recovering = false;
  #disposed = false;

  constructor(options: RecoveryOptions) {
    this.#options = options;
  }

  get view(): QueuedPromptRecoveryView {
    if (this.#disposed) return { state: "unavailable", reason: "session-unavailable" };
    if (this.#recovering) return { state: "recovering" };
    const reason = this.#unavailableReason();
    return reason ? { state: "unavailable", reason } : { state: "ready" };
  }

  admitQueuedPrompt(submit: () => Promise<void>): Promise<void> {
    this.#assertCurrent();
    if (this.#recovering) throw new Error("Wait for pending-message recovery before sending another queued message.");
    // Register before starting the RPC, including when submit throws synchronously.
    const admission = Promise.resolve().then(() => {
      this.#assertCurrent();
      return submit();
    });
    this.#admissions.add(admission);
    return admission.finally(() => this.#admissions.delete(admission));
  }

  async recoverAll(): Promise<QueuedPromptRecoveryOutcome> {
    this.#assertAvailable();
    if (this.#recovering) throw new Error("Pending-message recovery is already in progress.");
    this.#recovering = true;
    this.#options.onChange();
    try {
      await Promise.allSettled([...this.#admissions]);
      this.#assertAvailable();
      const { queuedSteers, queuedFollowUps } = this.#options.conversation.read();
      const candidates = [
        ...queuedSteers.map((prompt) => ({ prompt, queue: "steering" as const })),
        ...queuedFollowUps.map((prompt) => ({ prompt, queue: "followUp" as const })),
      ];
      const outcome: QueuedPromptRecoveryOutcome = {
        certainty: this.#options.runtime === "pi" ? "best-effort" : "confirmed",
        content: { text: "", images: [] }, recoveredCount: 0, notRemovedCount: 0, warnings: [],
      };
      if (candidates.length === 0) return outcome;
      this.#options.conversation.beginQueueRecovery();
      if (this.#options.runtime === "pi") {
        let cleared: RpcClearQueueResult;
        try {
          cleared = await this.#options.api.clearQueue();
        } catch {
          this.#assertCurrent();
          throw new Error("Pi did not confirm queue recovery. Some input may already have been removed; do not retry automatically.");
        }
        this.#assertCurrent();
        for (const { prompt } of candidates) this.#options.conversation.removeQueuedPrompt(prompt.id);
        const texts = [...cleared.steering, ...cleared.followUp];
        outcome.content.text = texts.join("\n\n");
        outcome.recoveredCount = texts.length;
        outcome.warnings.push("delivery-uncertain");
        return outcome;
      }

      const texts: string[] = [];
      const warnings = new Set<QueuedPromptRecoveryWarning>();
      for (const { prompt, queue } of candidates) {
        let result: RpcRemoveQueuedMessageResult;
        try {
          result = await this.#options.api.removeOmpQueuedMessage(prompt.text, queue);
        } catch {
          this.#assertCurrent();
          warnings.add("request-failed");
          // Preserve earlier confirmed removals; never retry a text-based mutation.
          outcome.notRemovedCount = candidates.length - outcome.recoveredCount;
          break;
        }
        this.#assertCurrent();
        if (!result.removed) {
          outcome.notRemovedCount += 1;
          warnings.add("not-removed");
          continue;
        }
        this.#options.conversation.removeQueuedPrompt(prompt.id);
        texts.push(prompt.text);
        outcome.recoveredCount += 1;
        if (result.imagesDropped || (prompt.images.length > 0 && !result.images?.length)) warnings.add("images-dropped");
        try {
          const images = this.#draftImages(result.images ?? []);
          if (images.length + outcome.content.images.length > this.#options.getAttachmentLimits().maxImages) {
            warnings.add("images-dropped");
          } else {
            outcome.content.images.push(...images);
          }
        } catch {
          // Removal already happened. Return the text and an explicit partial result.
          warnings.add("images-dropped");
        }
      }
      outcome.content.text = texts.join("\n\n");
      outcome.warnings = [...warnings];
      return outcome;
    } finally {
      this.#recovering = false;
      if (!this.#disposed) this.#options.onChange();
    }
  }

  dispose(): void {
    this.#disposed = true;
  }

  #unavailableReason(): QueuedPromptRecoveryView["reason"] {
    const availability = this.#options.readAvailability();
    if (availability === "unavailable") return "session-unavailable";
    if (availability === "compacting") return "compacting";
    const { queuedSteers, queuedFollowUps } = this.#options.conversation.read();
    const imageCount = [...queuedSteers, ...queuedFollowUps].reduce((count, prompt) => count + prompt.images.length, 0);
    if (this.#options.runtime === "pi" && imageCount > 0) return "images-not-supported";
    if (imageCount > this.#options.getAttachmentLimits().maxImages) return "image-limit";
    return undefined;
  }

  #assertAvailable(): void {
    this.#assertCurrent();
    const reason = this.#unavailableReason();
    if (reason === "compacting") throw new Error("Wait for compaction to finish before recovering pending messages.");
    if (reason === "images-not-supported") throw new Error("Pi cannot return queued images. Pending messages were not changed.");
    if (reason === "image-limit") throw new Error("Pending images exceed the Composer image limit. Pending messages were not changed.");
    if (reason) throw new Error("This session is not available for pending-message recovery.");
  }

  #assertCurrent(): void {
    if (this.#disposed) throw new Error("The session process changed during pending-message recovery.");
  }

  #draftImages(images: RpcImageContent[]): ComposerDraftImageView[] {
    const { maxImageBytes, maxImages } = this.#options.getAttachmentLimits();
    if (images.length > maxImages) throw new Error("Too many recovered images.");
    const inputs = images.map((image, index): ComposerDraftImageView => ({
      id: `recovered-${randomUUID()}`,
      name: `Recovered image ${index + 1}`,
      mimeType: image.mimeType as ComposerDraftImageView["mimeType"],
      data: image.data,
      size: Buffer.byteLength(image.data, "base64"),
    }));
    normalizeImageAttachments(inputs, maxImageBytes);
    return inputs;
  }
}
