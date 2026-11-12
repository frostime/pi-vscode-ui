import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLocalMarkdownImage } from "@frostime/pi-client/host/bridge/markdown-images/MarkdownImageResolver";

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
    expect(relative).toMatchObject({ ok: true, mimeType: "image/png" });

    const fileUri = await resolveLocalMarkdownImage(pathToFileURL(path).href, directory, 1024);
    expect(fileUri).toMatchObject({ ok: true, mimeType: "image/png" });

    const literalPercent = await resolveLocalMarkdownImage("100%.png", directory, 1024);
    expect(literalPercent).toMatchObject({ ok: true, mimeType: "image/png" });
  });

  it("returns stable failures for absent, oversized, and unsupported files", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "large.png"), png(20, 20));
    await writeFile(join(directory, "text.png"), "not an image");

    await expect(resolveLocalMarkdownImage("missing.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(resolveLocalMarkdownImage("large.png", directory, 20)).resolves.toEqual({ ok: false, reason: "tooLarge" });
    await expect(resolveLocalMarkdownImage("text.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "unsupportedType" });
  });

  it("accepts common SVG preambles for browser-side sanitization but rejects non-local protocols", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "diagram.svg"), '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');

    const svg = await resolveLocalMarkdownImage("diagram.svg", directory, 1024);
    expect(svg).toMatchObject({ ok: true, mimeType: "image/svg+xml" });
    await expect(resolveLocalMarkdownImage("https://example.com/image.png", directory, 1024)).resolves.toEqual({ ok: false, reason: "invalidSource" });
  });

  it.each([
    ["a UNC path", "\\\\attacker.example\\share\\image.png"],
    ["a forward-slash UNC path", "//attacker.example/share/image.png"],
    ["a mixed-separator UNC path", "/\\attacker.example\\share\\image.png"],
    ["a WebDAV UNC path", "\\\\attacker.example@SSL\\share\\image.png"],
    ["a file URL with a host", "file://attacker.example/share/image.png"],
    ["an upper-case file URL with a host", "FILE://ATTACKER.EXAMPLE/share/image.png"],
    ["a percent-encoded UNC path", "%5C%5Cattacker.example%5Cshare%5Cimage.png"],
    ["a UNC device path", "\\\\?\\UNC\\attacker.example\\share\\image.png"],
    ["a device namespace path", "\\\\.\\pipe\\image.png"],
  ])("refuses %s on Windows before touching the filesystem", async (_form, source) => {
    // A filesystem attempt would report notFound here; invalidSource proves there was none.
    await expect(resolveLocalMarkdownImage(source, "C:\\workspace", 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
  });

  it("still resolves drive and Session-relative paths on Windows", async () => {
    for (const source of ["C:\\images\\a.png", "C:/images/a.png", "file:///C:/images/a.png", "images\\a.png", "..\\a.png"]) {
      await expect(resolveLocalMarkdownImage(source, "C:\\workspace", 1024, "win32"))
        .resolves.toEqual({ ok: false, reason: "notFound" });
    }
  });

  it("lets a Session on a network share read only from that same share", async () => {
    const cwd = "\\\\fileserver\\projects\\app";

    await expect(resolveLocalMarkdownImage("docs\\a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(resolveLocalMarkdownImage("\\\\FILESERVER\\projects\\shared\\a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(resolveLocalMarkdownImage("\\\\fileserver\\other\\a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
    await expect(resolveLocalMarkdownImage("\\\\attacker.example\\projects\\a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
    // A file URL is judged by the path it names, like any other source.
    await expect(resolveLocalMarkdownImage("file://fileserver/projects/app/a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(resolveLocalMarkdownImage("file://attacker.example/projects/app/a.png", cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
  });

  it.each([
    ["\\\\?\\UNC\\fileserver\\projects\\app", "\\\\?\\UNC\\attacker.example\\share\\a.png"],
    ["\\\\?\\UNC\\fileserver\\projects\\app", "a.png"],
    ["\\\\.\\C:\\workspace", "\\\\.\\C:\\..\\UNC\\attacker.example\\share\\a.png"],
    ["\\\\?\\C:\\workspace", "\\\\?\\C:\\workspace\\a.png"],
  ])("never accepts a device-namespace path, even from a Session opened as %s", async (cwd, source) => {
    // Every \\?\UNC\… path shares one parsed root, so a same-root exception would admit any server.
    await expect(resolveLocalMarkdownImage(source, cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
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
