import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

// MarkdownContent renders MarkdownHtml, whose sanitizer needs a browser window;
// the timestamp chrome under test does not depend on sanitized output.
vi.mock("dompurify", () => ({ default: { sanitize: (markup: string) => markup } }));

import type { ConversationMessageView, ResponseActivityView } from "@frostime/pi-client/shared/model/conversationModel";
import ResponseActivity from "$ui/features/conversation/ResponseActivity.svelte";
import UserMessage from "$ui/features/conversation/UserMessage.svelte";
import { formatMessageTimestamp } from "$ui/features/conversation/messageTimestamp.js";

describe("formatMessageTimestamp", () => {
  const now = new Date(2025, 8, 5, 18, 0).getTime();

  it("hides invalid timestamps (projection fallback 0 or garbage)", () => {
    expect(formatMessageTimestamp(0, now, "en-US")).toBeNull();
    expect(formatMessageTimestamp(Number.NaN, now, "en-US")).toBeNull();
  });

  it("distinguishes today, the previous day, this year and earlier years", () => {
    const today = formatMessageTimestamp(new Date(2025, 8, 5, 14, 32).getTime(), now, "en-US");
    const yesterday = formatMessageTimestamp(new Date(2025, 8, 4, 14, 32).getTime(), now, "en-US");
    const thisYear = formatMessageTimestamp(new Date(2025, 8, 1, 14, 32).getTime(), now, "en-US");
    const earlier = formatMessageTimestamp(new Date(2024, 0, 15, 14, 32).getTime(), now, "en-US");

    expect(new Set([today, yesterday, thisYear, earlier]).size).toBe(4);
    expect(today!.length).toBeLessThan(yesterday!.length);
    expect(thisYear).toContain("/");
    expect(earlier).toContain("2024");
  });
});

describe("message timestamp chrome", () => {
  const timestamp = new Date(2025, 8, 5, 14, 32).getTime();
  const expectedDatetime = new Date(timestamp).toISOString();

  it("renders the label inside the user action row", () => {
    const body = render(UserMessage, {
      props: {
        message: userMessage(timestamp),
        session: {} as never,
      },
    }).body;

    expect(body).toContain(`datetime="${expectedDatetime}"`);
  });

  it("omits the label when the timestamp is the projection fallback 0", () => {
    const user = render(UserMessage, { props: { message: userMessage(0), session: {} as never } }).body;
    const response = render(ResponseActivity, {
      props: { activity: responseActivity(0), sessionId: "session-1" },
    }).body;

    expect(user).not.toContain("action-row-timestamp");
    expect(response).not.toContain("action-row-timestamp");
  });

  it("renders the label inside the response action row", () => {
    const body = render(ResponseActivity, {
      props: { activity: responseActivity(timestamp), sessionId: "session-1" },
    }).body;

    expect(body).toContain(`datetime="${expectedDatetime}"`);
  });
});

function userMessage(timestamp: number): ConversationMessageView {
  return {
    id: "message-1",
    sourceEntryId: "entry-1",
    role: "user",
    blocks: [{ type: "text", text: "hello" }],
    status: "complete",
    timestamp,
  };
}

function responseActivity(timestamp: number): ResponseActivityView {
  return {
    id: "response-1",
    type: "response",
    blocks: [{ type: "text", text: "done" }],
    status: "complete",
    timestamp,
  };
}
