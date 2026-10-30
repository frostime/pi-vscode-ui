import { describe, expect, it } from "vitest";

import { normalizeImageAttachments, validateProjectedImageAttachments } from "../../src/core/attachments/normalizeImageAttachment.js";

const png = { id: "1", name: "shot.png", mimeType: "image/png" as const, data: "aGVsbG8=", size: 5 };

describe("image prompt normalization", () => {
  it("produces Pi image content without persisting UI metadata", () => {
    expect(normalizeImageAttachments([png], 1024)).toEqual([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
  });

  it("rejects declared and encoded payloads over the configured boundary", () => {
    expect(() => normalizeImageAttachments([{ ...png, size: 2048 }], 1024)).toThrow(/exceeds the 0.0 MB image limit/);
    expect(() => normalizeImageAttachments([{ ...png, data: "a".repeat(2000), size: 1500 }], 1024)).toThrow(/exceeds the 0.0 MB image limit/);
  });

  it("rejects malformed Base64 and inconsistent size metadata", () => {
    expect(() => normalizeImageAttachments([{ ...png, data: "not base64!" }], 1024)).toThrow(/invalid Base64/);
    expect(() => normalizeImageAttachments([{ ...png, size: 5000 }], 10_000)).toThrow(/inconsistent image size metadata/);
  });

  it("applies the prompt submission checks to projected Fork images", () => {
    const image = { id: "1", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=", size: 5 };
    expect(validateProjectedImageAttachments([image], 12, 1024)).toEqual([image]);
    expect(() => validateProjectedImageAttachments([{ ...image, dataUrl: "data:image/png;base64,not base64!" }], 12, 1024)).toThrow(/invalid Base64/);
    expect(() => validateProjectedImageAttachments([{ ...image, size: 5000 }], 12, 10_000)).toThrow(/inconsistent image size metadata/);
    expect(() => validateProjectedImageAttachments(Array.from({ length: 13 }, (_, index) => ({ ...image, id: String(index) })), 12, 1024)).toThrow(/more than 12 images/);
  });
});
