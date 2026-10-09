import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
  folders: [] as Array<{ uri: { fsPath: string; scheme: string } }>,
}));

vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return environment.folders; } },
  Uri: { file: (fsPath: string) => ({ fsPath, scheme: "file" }) },
}));

import { workspaceUriForPath } from "../../src/extension/configuration/workspaceScope.js";

describe("workspace configuration scope", () => {
  afterEach(() => { environment.folders = []; });

  it("returns the original workspace URI for an alias or its real path", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-scope-alias-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const uri = { fsPath: alias, scheme: "vscode-remote" };
    environment.folders = [{ uri }];

    expect(workspaceUriForPath(alias)).toBe(uri);
    expect(workspaceUriForPath(target)).toBe(uri);
    expect(workspaceUriForPath(parent)).toEqual({ fsPath: parent, scheme: "file" });
  });
});
