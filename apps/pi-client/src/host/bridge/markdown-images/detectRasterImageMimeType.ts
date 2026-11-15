export type RasterImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif" | "image/bmp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectRasterImageMimeType(data: Uint8Array): RasterImageMimeType | null {
  if (matches(data, PNG_SIGNATURE)) return "image/png";
  if (matches(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(data, 0, 2) === "BM") return "image/bmp";
  if (isAvif(data)) return "image/avif";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";

  const gifVersion = ascii(data, 0, 6);
  if (gifVersion === "GIF87a" || gifVersion === "GIF89a") return "image/gif";
  return null;
}

function isAvif(data: Uint8Array): boolean {
  if (data.length < 16 || ascii(data, 4, 4) !== "ftyp") return false;
  const boxSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > data.length || boxSize % 4 !== 0) return false;

  // AVIF shares its container with other media. Check the major and compatible
  // brands within the file-type box, skipping the minor-version field at offset 12.
  for (let offset = 8; offset < boxSize; offset += 4) {
    if (offset === 12) continue;
    const brand = ascii(data, offset, 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

function matches(data: Uint8Array, expected: readonly number[]): boolean {
  return data.length >= expected.length && expected.every((byte, index) => data[index] === byte);
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  if (data.length < offset + length) return "";
  return String.fromCharCode(...data.subarray(offset, offset + length));
}
