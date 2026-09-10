import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLocalMarkdownImage } from "../../src/extension/webview-host/markdown-images/MarkdownImageResolver.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("resolveLocalMarkdownImage", () => {
  it("resolves relative and file URI images and identifies content instead of extensions", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "misleading.txt");
    await writeFile(path, png(24, 12));
    await writeFile(join(directory, "100%.png"), png(10, 10));

    const relative = await resolveLocalMarkdownImage("misleading.txt", directory, 1024);
    expect(relative).toMatchObject({ ok: true, mimeType: "image/png", width: 24, height: 12 });

    const fileUri = await resolveLocalMarkdownImage(pathToFileURL(path).href, directory, 1024);
    expect(fileUri).toMatchObject({ ok: true, mimeType: "image/png", width: 24, height: 12 });

    const literalPercent = await resolveLocalMarkdownImage("100%.png", directory, 1024);
    expect(literalPercent).toMatchObject({ ok: true, mimeType: "image/png", width: 10, height: 10 });
  });

  it("returns stable failures for absent, oversized, unsupported, and pixel-bomb files", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "large.png"), png(20, 20));
    await writeFile(join(directory, "text.png"), "not an image");
    await writeFile(join(directory, "bomb.png"), png(16_385, 1));

    await expect(resolveLocalMarkdownImage("missing.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(resolveLocalMarkdownImage("large.png", directory, 20)).resolves.toEqual({ ok: false, reason: "tooLarge" });
    await expect(resolveLocalMarkdownImage("text.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "unsupportedType" });
    await expect(resolveLocalMarkdownImage("bomb.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "invalidDimensions" });
  });

  it("accepts common SVG preambles for browser-side sanitization but rejects non-local protocols", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "diagram.svg"), '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');

    const svg = await resolveLocalMarkdownImage("diagram.svg", directory, 1024);
    expect(svg).toMatchObject({ ok: true, mimeType: "image/svg+xml" });
    await expect(resolveLocalMarkdownImage("https://example.com/image.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "invalidSource" });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-markdown-image-"));
  temporaryDirectories.push(directory);
  return directory;
}

function png(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  data.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32Be(data, 16, width);
  writeUint32Be(data, 20, height);
  return data;
}

function writeUint32Be(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}
