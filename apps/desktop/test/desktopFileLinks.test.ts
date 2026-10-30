import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ openExternal: vi.fn(), openPath: vi.fn() }));

import { openReferencedLocation as openLocation } from "../src/main/openReferencedLocation.js";
const openReferencedLocation = (reference: Parameters<typeof openLocation>[0], cwd: string | undefined) => openLocation(reference, cwd, native);

let cwd: string;
beforeEach(async () => {
  cwd = await realpath(await mkdtemp(join(tmpdir(), "frostpi-file-links-")));
  vi.resetAllMocks();
  native.openExternal.mockResolvedValue(undefined);
  native.openPath.mockResolvedValue("");
});
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

describe("Desktop file references", () => {
  it.each(["code & #100% 中文.ts", "script.ps1", "script.py", "script.sh", "page.html", "diagram.svg", ".bashrc", "Makefile", "settings.json"])("opens %s only in VS Code with an encoded file URI and line/column", async (name) => {
    const path = join(cwd, name);
    await writeFile(path, "synthetic file, never execute");
    await openReferencedLocation({ path: name, line: 42, column: 5 }, cwd);
    expect(native.openExternal).toHaveBeenCalledTimes(1);
    const uri = new URL(native.openExternal.mock.calls[0]![0] as string);
    expect(uri.protocol).toBe("vscode:");
    expect(uri.hostname).toBe("file");
    const forwardPath = path.replaceAll("\\", "/");
    expect(decodeURIComponent(uri.pathname)).toBe(`${forwardPath.startsWith("/") ? "" : "/"}${forwardPath}:42:5`);
    expect(uri.search).toBe("");
    expect(uri.hash).toBe("");
    expect(native.openPath).not.toHaveBeenCalled();
  });

  it("opens the start of a line range without inventing an external-editor selection", async () => {
    await writeFile(join(cwd, "file.ts"), "synthetic code");
    await openReferencedLocation({ path: "file.ts", line: 7, endLine: 9 }, cwd);
    expect(new URL(native.openExternal.mock.calls[0]![0] as string).pathname).toMatch(/\/file\.ts:7:1$/);
    expect(native.openPath).not.toHaveBeenCalled();
  });

  it.each(["note.md", "notes.txt", "image.PNG", "document.pdf", "LICENSE"])("opens %s through the default application without a location suffix", async (name) => {
    const path = join(cwd, name);
    await writeFile(path, "synthetic document");
    await openReferencedLocation({ path: name, line: 7, endLine: 9 }, cwd);
    expect(native.openPath).toHaveBeenCalledExactlyOnceWith(path);
    expect(native.openExternal).not.toHaveBeenCalled();
  });

  it("opens actual directories even with an unknown suffix, without needing a Session for absolute paths", async () => {
    const path = join(cwd, "directory.unknown");
    await mkdir(path);
    await openReferencedLocation({ path }, undefined);
    expect(native.openPath).toHaveBeenCalledExactlyOnceWith(path);
    expect(native.openExternal).not.toHaveBeenCalled();
  });

  it.each(["program.exe", "script.cmd", "shortcut.lnk", "archive.zip", "unknown.xyz"])("rejects %s outside the shared whitelist even for an explicit file link", async (name) => {
    await writeFile(join(cwd, name), "never execute");
    await expect(openReferencedLocation({ path: name }, cwd)).rejects.toThrow("not supported");
    expect(native.openPath).not.toHaveBeenCalled();
    expect(native.openExternal).not.toHaveBeenCalled();
  });

  it("does not use the process cwd, create missing files or accept application protocols", async () => {
    await expect(openReferencedLocation({ path: "file.ts" }, undefined)).rejects.toThrow("Session working directory");
    await expect(openReferencedLocation({ path: "missing.ts" }, cwd)).rejects.toThrow("does not exist");
    for (const path of ["https://example.com/file.ts", "vscode://file/file.ts", "file:///file.ts", "javascript:alert(1)"]) {
      await expect(openReferencedLocation({ path }, cwd)).rejects.toThrow("Only local");
    }
    expect(native.openPath).not.toHaveBeenCalled();
    expect(native.openExternal).not.toHaveBeenCalled();
  });

  it("checks symlink targets and never opens an allowed document alias as an executable", async (context) => {
    const executable = join(cwd, "program.cmd");
    const alias = join(cwd, "document.txt");
    await writeFile(executable, "never execute");
    try { await symlink(executable, alias); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip(); return; }
      throw error;
    }
    await expect(openReferencedLocation({ path: alias }, cwd)).rejects.toThrow("not supported");
    expect(native.openPath).not.toHaveBeenCalled();
    expect(native.openExternal).not.toHaveBeenCalled();
  });

  it("reports native errors and never falls back from VS Code to a script association", async () => {
    await writeFile(join(cwd, "script.py"), "never execute");
    native.openExternal.mockRejectedValueOnce(new Error("handler unavailable"));
    await expect(openReferencedLocation({ path: "script.py", line: 4 }, cwd)).rejects.toThrow("VS Code");
    expect(native.openPath).not.toHaveBeenCalled();
    await writeFile(join(cwd, "note.txt"), "document");
    native.openPath.mockResolvedValueOnce("No associated application");
    await expect(openReferencedLocation({ path: "note.txt" }, cwd)).rejects.toThrow("default application");
  });
});
