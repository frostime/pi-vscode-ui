export type RasterImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface RasterImageInfo {
  mimeType: RasterImageMimeType;
  width: number;
  height: number;
}

export function inspectRasterImage(data: Uint8Array): RasterImageInfo | null {
  return inspectPng(data) ?? inspectJpeg(data) ?? inspectWebp(data) ?? inspectGif(data);
}

export function hasSafeRasterDimensions(
  image: RasterImageInfo,
  maxDimension = 16_384,
  maxPixels = 40_000_000,
): boolean {
  return image.width > 0
    && image.height > 0
    && image.width <= maxDimension
    && image.height <= maxDimension
    && image.width * image.height <= maxPixels;
}

function inspectPng(data: Uint8Array): RasterImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || !matches(data, 0, signature) || ascii(data, 12, 4) !== "IHDR") return null;
  return { mimeType: "image/png", width: uint32Be(data, 16), height: uint32Be(data, 20) };
}

function inspectGif(data: Uint8Array): RasterImageInfo | null {
  if (data.length < 10) return null;
  const version = ascii(data, 0, 6);
  if (version !== "GIF87a" && version !== "GIF89a") return null;
  return { mimeType: "image/gif", width: uint16Le(data, 6), height: uint16Le(data, 8) };
}

function inspectJpeg(data: Uint8Array): RasterImageInfo | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset++]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= data.length) return null;
    const segmentLength = uint16Be(data, offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (isStartOfFrame(marker) && segmentLength >= 7) {
      return {
        mimeType: "image/jpeg",
        height: uint16Be(data, offset + 3),
        width: uint16Be(data, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function inspectWebp(data: Uint8Array): RasterImageInfo | null {
  if (data.length < 16 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WEBP") return null;
  const chunk = ascii(data, 12, 4);
  if (chunk === "VP8X" && data.length >= 30) {
    return {
      mimeType: "image/webp",
      width: 1 + uint24Le(data, 24),
      height: 1 + uint24Le(data, 27),
    };
  }
  if (chunk === "VP8 " && data.length >= 30 && matches(data, 23, [0x9d, 0x01, 0x2a])) {
    return {
      mimeType: "image/webp",
      width: uint16Le(data, 26) & 0x3fff,
      height: uint16Le(data, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && data[20] === 0x2f && data.length >= 25) {
    const b0 = data[21]!;
    const b1 = data[22]!;
    const b2 = data[23]!;
    const b3 = data[24]!;
    return {
      mimeType: "image/webp",
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    };
  }
  return null;
}

function matches(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => data[offset + index] === byte);
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

function uint16Be(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function uint16Le(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function uint24Le(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16);
}

function uint32Be(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0;
}
