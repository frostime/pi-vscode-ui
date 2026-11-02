import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import type { RestoreQueuedPromptsResult } from "@frostime/pi-client/shared/bridge/hostToWebview";
import { DESKTOP_MESSAGE_LIMIT_ERROR, DESKTOP_TRANSPORT_BLOCKED_CHANNEL } from "../shared/desktopTransport.js";
import type { DesktopWire } from "./DesktopWire.js";

/** Keep delivery failures local to Desktop; shared WebviewConnection consumes the boolean result. */
export function createDesktopPublisher(wire: Pick<DesktopWire, "send">) {
  let blocked = false;
  const publish = (channel: string, value: unknown): boolean => {
    const delivered = wire.send({ kind: "event", channel, value });
    const message = channel === "frostpi:client:out" && value && typeof value === "object" ? value as Record<string, unknown> : undefined;
    if (!delivered) {
      if (message?.type === "snapshot" || message?.type === "presentationDelta") {
        if (!blocked) wire.send({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: true });
        blocked = true;
      } else if (message?.type === "markdownImageResult") {
        wire.send({ kind: "event", channel, value: { bridgeVersion: BRIDGE_VERSION, type: "markdownImageResult", requestId: message.requestId, sessionId: message.sessionId, result: { ok: false, reason: "tooLarge" } } });
      } else if (message?.type === "restoreQueuedPromptsResult") {
        const recovery = value as RestoreQueuedPromptsResult;
        const textOnly = recovery.ok && recovery.draftTarget === "webview-merge" ? {
          ...recovery, bridgeVersion: BRIDGE_VERSION,
          outcome: {
            ...recovery.outcome,
            content: { ...recovery.outcome.content, images: [] },
            warnings: [...new Set([...recovery.outcome.warnings, "host-size-limit"])],
          },
        } : undefined;
        // Queue mutation already happened. Preserve text when it fits, otherwise
        // return a small correlated failure rather than leaving the request pending.
        if (!textOnly || !wire.send({ kind: "event", channel, value: textOnly })) {
          wire.send({ kind: "event", channel, value: {
            bridgeVersion: BRIDGE_VERSION, type: "restoreQueuedPromptsResult",
            requestId: recovery.requestId, sessionId: recovery.sessionId, ok: false,
            error: `${DESKTOP_MESSAGE_LIMIT_ERROR} Queue recovery may already have changed pending input.`,
          } });
        }
      } else {
        wire.send({ kind: "event", channel: "frostpi:client:out", value: { bridgeVersion: BRIDGE_VERSION, type: "toast", level: "error", message: DESKTOP_MESSAGE_LIMIT_ERROR } });
      }
    } else if (blocked && message?.type === "snapshot") {
      // Only a full delivered snapshot establishes a valid base after a rejected update.
      wire.send({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: false });
      blocked = false;
    }
    return delivered;
  };
  return {
    publish,
    // A reloaded renderer has new listeners; replay without resetting the delivery state.
    replay: () => { if (blocked) wire.send({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: true }); },
  };
}
