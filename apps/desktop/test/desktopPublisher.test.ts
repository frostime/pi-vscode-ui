import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { DESKTOP_TRANSPORT_BLOCKED_CHANNEL } from "../src/shared/desktopTransport.js";
import { DesktopWire } from "../src/main/DesktopWire.js";
import { createDesktopPublisher } from "../src/main/publishDesktopEvent.js";

function publisher() {
  const output = new PassThrough(); const packets: Array<{ channel: string; value: unknown }> = [];
  output.on("data", (chunk: Buffer) => packets.push(JSON.parse(chunk.toString()) as { channel: string; value: unknown }));
  const wire = new DesktopWire(new PassThrough(), output, 1024);
  return { wire, packets, ...createDesktopPublisher(wire) };
}

describe("Desktop publication limit", () => {
  it("rejects a large view, signals once, and recovers only after a full delivered snapshot", async () => {
    const { wire, packets, publish, replay } = publisher();
    let disconnected = false; wire.on("disconnect", () => disconnected = true);
    expect(publish("frostpi:client:out", { type: "snapshot", data: "x".repeat(2048) })).toBe(false);
    expect(publish("frostpi:client:out", { type: "presentationDelta", data: "x".repeat(2048) })).toBe(false);
    expect(publish("frostpi:client:out", { type: "presentationDelta" })).toBe(true);
    await wire.flush();
    expect(packets.filter((p) => p.channel === DESKTOP_TRANSPORT_BLOCKED_CHANNEL).map((p) => p.value)).toEqual([true]);
    replay();
    await wire.flush();
    expect(packets.filter((p) => p.channel === DESKTOP_TRANSPORT_BLOCKED_CHANNEL).map((p) => p.value)).toEqual([true, true]);
    expect(publish("frostpi:client:out", { type: "snapshot" })).toBe(true);
    await wire.flush();
    expect(packets.filter((p) => p.channel === DESKTOP_TRANSPORT_BLOCKED_CHANNEL).map((p) => p.value)).toEqual([true, true, false]);
    expect(disconnected).toBe(false);
    expect(packets.some((p) => JSON.stringify(p.value).includes("x".repeat(2048)))).toBe(false);
  });
  it("keeps recovered text and correlation when returned images exceed the transport limit", async () => {
    const { wire, packets, publish } = publisher();
    expect(publish("frostpi:client:out", {
      type: "restoreQueuedPromptsResult", requestId: "recovery", sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: {
        certainty: "confirmed", recoveredCount: 1, notRemovedCount: 0, warnings: [],
        content: { text: "recovered text", images: [{ data: "x".repeat(2048), mimeType: "image/png", id: "image", name: "image", size: 1536 }] },
      },
    })).toBe(false);
    await wire.flush();
    expect(packets).toHaveLength(1);
    expect(packets[0]?.value).toMatchObject({
      type: "restoreQueuedPromptsResult", requestId: "recovery", sessionId: "session", ok: true,
      outcome: { content: { text: "recovered text", images: [] }, warnings: ["host-size-limit"] },
    });
  });

  it("returns a small correlated failure when even recovered text cannot fit", async () => {
    const { wire, packets, publish } = publisher();
    publish("frostpi:client:out", {
      type: "restoreQueuedPromptsResult", requestId: "large-text", sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: { certainty: "best-effort", recoveredCount: 1, notRemovedCount: 0, warnings: [], content: { text: "x".repeat(2048), images: [] } },
    });
    await wire.flush();
    expect(packets).toHaveLength(1);
    expect(packets[0]?.value).toMatchObject({
      type: "restoreQueuedPromptsResult", requestId: "large-text", sessionId: "session", ok: false,
    });
    expect((packets[0]?.value as { error: string }).error).toContain("may already have changed pending input");
  });

  it("settles a rejected image request with the existing tooLarge result", async () => {
    const { wire, packets, publish } = publisher();
    expect(publish("frostpi:client:out", { type: "markdownImageResult", requestId: "r", sessionId: "s", result: { ok: true, data: "x".repeat(2048) } })).toBe(false);
    await wire.flush();
    expect(packets[0]?.value).toMatchObject({ type: "markdownImageResult", requestId: "r", sessionId: "s", result: { ok: false, reason: "tooLarge" } });
  });
});
