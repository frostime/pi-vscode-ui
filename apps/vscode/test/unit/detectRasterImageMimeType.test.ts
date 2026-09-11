import { describe, expect, it } from "vitest";

import { detectRasterImageMimeType } from "../../src/extension/webview-host/markdown-images/detectRasterImageMimeType.js";

describe("detectRasterImageMimeType", () => {
  it("recognizes each supported raster format from its signature", () => {
    expect(detectRasterImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectRasterImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(detectRasterImageMimeType(new TextEncoder().encode("RIFF0000WEBP"))).toBe("image/webp");
    expect(detectRasterImageMimeType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
  });

  it("rejects truncated and unknown signatures", () => {
    expect(detectRasterImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectRasterImageMimeType(new TextEncoder().encode("not an image"))).toBeNull();
  });
});
