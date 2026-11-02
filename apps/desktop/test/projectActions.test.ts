import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectActions, type ProjectAction, type ProjectActionEnvironment } from "../src/main/projectActions.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function binDirectory(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-actions-bin-"));
  directories.push(directory);
  for (const file of files) await writeFile(join(directory, file), "");
  return directory;
}

/** Real PATH entries and real files, so detection is exercised against the filesystem. */
function environment(...directories: string[]): ProjectActionEnvironment {
  return {
    PATH: directories.join(";"),
    exists: async (path) => {
      try { await access(path, constants.X_OK); return true; }
      catch { return false; }
    },
  };
}

function registry() {
  return new ProjectActions({ launch: vi.fn(() => Promise.resolve()), openPath: vi.fn(() => Promise.resolve("")) });
}

describe("ProjectActions", () => {
  it("projects enabled actions in registry order and drops undetected tools", async () => {
    const terminal = await binDirectory(["wt.exe"]);
    const editors = await binDirectory(["code.cmd"]);
    const actions = registry();

    await actions.initialize(environment(terminal, editors));

    expect(actions.view).toEqual([
      { id: "reveal", label: "Open in File Explorer", icon: "codicon-folder-opened" },
      { id: "vscode", label: "Open in VS Code", icon: "codicon-vscode" },
      { id: "terminal", label: "Open in Windows Terminal", icon: "codicon-terminal" },
    ]);
  });

  it("exposes no actions before initialization and treats a throwing probe as unavailable", async () => {
    const broken: ProjectAction[] = [
      { id: "reveal", label: "Open in File Explorer", icon: "codicon-folder-opened", invoke: () => Promise.resolve() },
      { id: "broken", label: "Broken", icon: "codicon-warning", detect: () => Promise.reject(new Error("probe failure")), invoke: () => Promise.resolve() },
    ];
    const actions = new ProjectActions({ launch: vi.fn(() => Promise.resolve()), openPath: vi.fn(() => Promise.resolve("")) }, broken);
    expect(actions.view).toEqual([]);

    await expect(actions.initialize(environment())).resolves.toBeUndefined();

    expect(actions.view.map((action) => action.id)).toEqual(["reveal"]);
    await expect(actions.run("broken", "C:/project")).rejects.toThrow("not available on this machine");
  });

  it("rejects unknown ids and known ids that detection disabled", async () => {
    const actions = registry();
    await actions.initialize(environment(await binDirectory([])));

    await expect(actions.run("unknown", "C:/project")).rejects.toThrow("Unknown Project action");
    await expect(actions.run(42, "C:/project")).rejects.toThrow("Unknown Project action");
    await expect(actions.run("zed", "C:/project")).rejects.toThrow('Project action "zed" is not available');
  });

  it("prefers the earlier candidate name over the earlier PATH directory", async () => {
    const exeOnly = await binDirectory(["code.exe"]);
    const cmdShim = await binDirectory(["code.cmd"]);
    const launch = vi.fn(() => Promise.resolve());
    const actions = new ProjectActions({ launch, openPath: vi.fn(() => Promise.resolve("")) });
    await actions.initialize(environment(exeOnly, cmdShim));

    await actions.run("vscode", "C:/project");

    expect(launch).toHaveBeenCalledWith(join(cmdShim, "code.cmd"), ["-n", "C:/project"]);
  });

  it("launches each detected tool with its resolved executable and exact arguments", async () => {
    const bin = await binDirectory(["code.cmd", "zed.exe", "wt.exe"]);
    const launch = vi.fn(() => Promise.resolve());
    const actions = new ProjectActions({ launch, openPath: vi.fn(() => Promise.resolve("")) });
    await actions.initialize(environment(bin));

    await actions.run("vscode", "C:/project");
    expect(launch).toHaveBeenLastCalledWith(join(bin, "code.cmd"), ["-n", "C:/project"]);

    await actions.run("zed", "C:/project");
    expect(launch).toHaveBeenLastCalledWith(join(bin, "zed.exe"), ["-n", "C:/project"]);

    await actions.run("terminal", "C:/project");
    expect(launch).toHaveBeenLastCalledWith(join(bin, "wt.exe"), ["-d", "C:/project"]);
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it("reveals the root through openPath and surfaces its error string", async () => {
    const openPath = vi.fn(() => Promise.resolve(""));
    const actions = new ProjectActions({ launch: vi.fn(() => Promise.resolve()), openPath });
    await actions.initialize(environment());

    await actions.run("reveal", "C:/project");
    expect(openPath).toHaveBeenCalledWith("C:/project");

    openPath.mockResolvedValueOnce("Could not open file");
    await expect(actions.run("reveal", "C:/project")).rejects.toThrow("Could not open file");
  });
});
