import { describe, expect, it } from "vitest";
import { DesktopDialogs } from "../src/main/dialogs.js";
import type { DesktopDialog } from "../src/shared/desktopBridge.js";

function latest(messages: Array<DesktopDialog | null>): DesktopDialog {
  const request = messages.at(-1);
  if (!request) throw new Error("Expected a visible desktop dialog");
  return request;
}

describe("Desktop host dialogs", () => {
  it("correlates a choice to its request and never selects a separator", async () => {
    const messages: Array<DesktopDialog | null> = [];
    const dialogs = new DesktopDialogs((request) => messages.push(request));
    const choice = { label: "Session", sessionId: "owned-session" };
    const items = [{ label: "Group", kind: "separator" as const }, choice];
    const selected = dialogs.showQuickPick(items);
    dialogs.respond("stale-request", "1");
    const request = latest(messages);
    dialogs.respond(request.id, "1");
    await expect(selected).resolves.toBe(choice);
    const separator = dialogs.showQuickPick(items);
    dialogs.respond(latest(messages).id, "0");
    await expect(separator).resolves.toBeUndefined();
  });

  it("keeps an invalid input open so the user can correct the same request", async () => {
    const messages: Array<DesktopDialog | null> = [];
    const dialogs = new DesktopDialogs((request) => messages.push(request));
    const value = dialogs.showInputBox({ validateInput: (text) => text.trim() ? undefined : "Enter summary focus." });
    const request = latest(messages);
    dialogs.respond(request.id, "");
    expect(latest(messages)).toMatchObject({ id: request.id, kind: "input", error: "Enter summary focus." });
    dialogs.respond(request.id, "Keep the technical decisions");
    await expect(value).resolves.toBe("Keep the technical decisions");
  });

  it("reports oversized input and cancels the pending request on window disposal", async () => {
    const messages: Array<DesktopDialog | null> = [];
    const dialogs = new DesktopDialogs((request) => messages.push(request));
    const value = dialogs.showInputBox();
    const request = latest(messages);
    dialogs.respond(request.id, "x".repeat(65_537));
    const feedback = latest(messages);
    expect(feedback.id).toBe(request.id);
    expect(feedback.kind === "input" ? feedback.error : undefined).toContain("65,536");
    dialogs.dispose();
    await expect(value).resolves.toBeUndefined();
    expect(messages.at(-1)).toBeNull();
  });
});
