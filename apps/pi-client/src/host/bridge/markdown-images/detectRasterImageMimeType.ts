export type RasterImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectRasterImageMimeType(data: Uint8Array): RasterImageMimeType | null {
  if (matches(data, PNG_SIGNATURE)) return "image/png";
  if (matches(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";

  const gifVersion = ascii(data, 0, 6);
  if (gifVersion === "GIF87a" || gifVersion === "GIF89a") return "image/gif";
  return null;
}

function matches(data: Uint8Array, expected: readonly number[]): boolean {
  return data.length >= expected.length && expected.every((byte, index) => data[index] === byte);
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  if (data.length < offset + length) return "";
  return String.fromCharCode(...data.subarray(offset, offset + length));
}
