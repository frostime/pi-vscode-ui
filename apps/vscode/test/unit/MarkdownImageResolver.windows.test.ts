import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLocalMarkdownImage } from "@frostime/pi-client/host/bridge/markdown-images/MarkdownImageResolver";

// Path-policy tests must never contact a real drive, share or device. Actual image
// reads remain covered by MarkdownImageResolver.test.ts with temporary files.
const fileSystem = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => fileSystem);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const localCwd = "C:\\workspace";
const shareCwd = "\\\\fileserver\\projects\\app";

beforeEach(() => {
  vi.resetAllMocks();
  fileSystem.stat.mockResolvedValue({ isFile: () => true, size: png.length });
  fileSystem.readFile.mockResolvedValue(png);
});

describe("Windows Markdown image path policy", () => {
  it.each([
    [localCwd, "\\\\attacker.example\\share\\image.png"],
    [localCwd, "//attacker.example/share/image.png"],
    [localCwd, "/\\attacker.example\\share\\image.png"],
    [localCwd, "\\\\attacker.example@SSL\\share\\image.png"],
    [localCwd, "file://attacker.example/share/image.png"],
    [localCwd, "FILE://ATTACKER.EXAMPLE/share/image.png"],
    [localCwd, "%5C%5Cattacker.example%5Cshare%5Cimage.png"],
    [localCwd, "\\\\?\\UNC\\attacker.example\\share\\image.png"],
    [localCwd, "\\\\.\\pipe\\image.png"],
    [shareCwd, "\\\\fileserver\\other\\a.png"],
    [shareCwd, "\\\\attacker.example\\projects\\a.png"],
    [shareCwd, "file://attacker.example/projects/app/a.png"],
    // Device namespaces must not gain the same-share exception through their roots.
    ["\\\\?\\UNC\\fileserver\\projects\\app", "\\\\?\\UNC\\attacker.example\\share\\a.png"],
    ["\\\\?\\UNC\\fileserver\\projects\\app", "a.png"],
    ["\\\\.\\C:\\workspace", "\\\\.\\C:\\..\\UNC\\attacker.example\\share\\a.png"],
    ["\\\\?\\C:\\workspace", "\\\\?\\C:\\workspace\\a.png"],
  ])("rejects %s / %s without filesystem access", async (cwd, source) => {
    await expect(resolveLocalMarkdownImage(source, cwd, 1024, "win32"))
      .resolves.toEqual({ ok: false, reason: "invalidSource" });
    expect(fileSystem.stat).not.toHaveBeenCalled();
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it.each([
    [localCwd, "C:\\images\\a.png", "C:\\images\\a.png"],
    [localCwd, "C:/images/a.png", "C:/images/a.png"],
    [localCwd, "file:///C:/images/a.png", "C:\\images\\a.png"],
    [localCwd, "images\\a.png", "C:\\workspace\\images\\a.png"],
    [localCwd, "..\\a.png", "C:\\a.png"],
    [shareCwd, "docs\\a.png", "\\\\fileserver\\projects\\app\\docs\\a.png"],
    [shareCwd, "\\\\FILESERVER\\projects\\shared\\a.png", "\\\\FILESERVER\\projects\\shared\\a.png"],
    [shareCwd, "file://fileserver/projects/app/a.png", "\\\\fileserver\\projects\\app\\a.png"],
  ])("reads %s / %s through the resolved path %s", async (cwd, source, expectedPath) => {
    await expect(resolveLocalMarkdownImage(source, cwd, 1024, "win32"))
      .resolves.toMatchObject({ ok: true, mimeType: "image/png" });
    expect(fileSystem.stat).toHaveBeenCalledExactlyOnceWith(expectedPath);
    expect(fileSystem.readFile).toHaveBeenCalledExactlyOnceWith(expectedPath);
  });
});
