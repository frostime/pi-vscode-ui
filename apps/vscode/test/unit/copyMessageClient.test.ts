import { describe, expect, it } from "vitest";

import { rawMessageText } from "$ui/features/conversation/copyMessageClient.js";

describe("message copy text", () => {
  it("preserves raw text block order without copying images or errors", () => {
    expect(rawMessageText([
      { type: "text", text: "**first**\n" },
      { type: "images", images: [{ id: "image", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 }] },
      { type: "text", text: "`second`" },
      { type: "error", text: "not copied" },
    ])).toBe("**first**\n`second`");
  });

  it("returns empty text for image-only messages", () => {
    expect(rawMessageText([{ type: "images", images: [] }])).toBe("");
  });
});
