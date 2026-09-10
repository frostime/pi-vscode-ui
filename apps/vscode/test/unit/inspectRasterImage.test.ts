import { describe, expect, it } from "vitest";

import {
  hasSafeRasterDimensions,
  inspectRasterImage,
} from "../../src/extension/webview-host/markdown-images/inspectRasterImage.js";

describe("inspectRasterImage", () => {
  it("reads dimensions from the supported raster headers", () => {
    expect(inspectRasterImage(png(640, 480))).toEqual({ mimeType: "image/png", width: 640, height: 480 });
    expect(inspectRasterImage(gif(320, 200))).toEqual({ mimeType: "image/gif", width: 320, height: 200 });
    expect(inspectRasterImage(jpeg(800, 600))).toEqual({ mimeType: "image/jpeg", width: 800, height: 600 });
    expect(inspectRasterImage(webpExtended(1024, 768))).toEqual({ mimeType: "image/webp", width: 1024, height: 768 });
  });

  it("rejects malformed headers and unsafe decoded dimensions", () => {
    expect(inspectRasterImage(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(hasSafeRasterDimensions({ mimeType: "image/png", width: 16_385, height: 1 })).toBe(false);
    expect(hasSafeRasterDimensions({ mimeType: "image/png", width: 10_000, height: 5_000 })).toBe(false);
    expect(hasSafeRasterDimensions({ mimeType: "image/png", width: 4_000, height: 4_000 })).toBe(true);
  });
});

function png(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  data.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32Be(data, 16, width);
  writeUint32Be(data, 20, height);
  return data;
}

function gif(width: number, height: number): Uint8Array {
  const data = new Uint8Array(10);
  data.set(new TextEncoder().encode("GIF89a"));
  writeUint16Le(data, 6, width);
  writeUint16Le(data, 8, height);
  return data;
}

function jpeg(width: number, height: number): Uint8Array {
  const data = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  return data;
}

function webpExtended(width: number, height: number): Uint8Array {
  const data = new Uint8Array(30);
  data.set(new TextEncoder().encode("RIFF"), 0);
  data.set(new TextEncoder().encode("WEBPVP8X"), 8);
  writeUint24Le(data, 24, width - 1);
  writeUint24Le(data, 27, height - 1);
  return data;
}

function writeUint16Le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
}

function writeUint24Le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
  data[offset + 2] = (value >> 16) & 0xff;
}

function writeUint32Be(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}
