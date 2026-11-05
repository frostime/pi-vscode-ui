import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectActions } from "../src/main/projectActions.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { expandActionCommand, quotePowerShellLiteral, type DesktopCommandAction } from "../src/shared/desktopActions.js";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

async function registry(commands: () => readonly DesktopCommandAction[], tools = ["wt.exe", "powershell.exe"]) {
  const launch = vi.fn<(executable: string, args: readonly string[]) => Promise<void>>().mockResolvedValue(undefined);
  const actions = new ProjectActions({ launch, commands, openPath: () => Promise.resolve("") });
  await actions.initialize({ PATH: "C:/Tools", exists: (path) => Promise.resolve(tools.includes(basename(path))) });
  return { actions, launch };
}

describe("terminal Actions", () => {
  it("preserves replacement tokens and PowerShell typographic apostrophes in path arguments", () => {
    const cwd = "C:/John’s ‘quoted’ ‚‛ $& $$ $` $' end";
    const literal = "'C:/John’’s ‘‘quoted’’ ‚‚‛‛ $& $$ $` $'' end'";
    expect(quotePowerShellLiteral(cwd)).toBe(literal);
    expect(expandActionCommand("tool --root {{cwd}} --again {{cwd}}", cwd)).toBe(`tool --root ${literal} --again ${literal}`);
  });

  it("shows lazygit only when the tool and terminal dependencies are available", async () => {
    const available = await registry(() => [], ["wt.exe", "powershell.exe", "lazygit.exe"]);
    expect(available.actions.view).toContainEqual({ id: "lazygit", label: "lazygit", icon: "codicon-globe", section: "actions", scope: "global" });
    await available.actions.run("lazygit", "C:/repo");
    expect(available.launch).toHaveBeenCalledOnce();
    const script = Buffer.from(available.launch.mock.calls[0]![1].at(-1)!, "base64").toString("utf16le");
    expect(script).toContain("-LiteralPath 'C:/repo'");
    expect(script).toMatch(/& '.*lazygit\.exe'/u);

    const missingShell = await registry(() => [], ["wt.exe", "lazygit.exe"]);
    expect(missingShell.actions.view.some((action) => action.id === "lazygit")).toBe(false);
    const missingTool = await registry(() => []);
    expect(missingTool.actions.view.some((action) => action.id === "lazygit")).toBe(false);
  });

  it("projects only command metadata and authorizes project commands again at execution", async () => {
    const commands: DesktopCommandAction[] = [
      { id: "local", label: "Local", command: "git -C {{cwd}} status", projectId: "project-a" },
      { id: "global", label: "Global", command: "Write-Output secret" },
    ];
    const { actions, launch } = await registry(() => commands);
    expect(actions.view.filter((action) => action.section === "actions")).toEqual([
      { id: "custom:global", label: "Global", icon: "codicon-globe", section: "actions", scope: "global" },
      { id: "custom:local", label: "Local", icon: "codicon-folder", section: "actions", scope: "project", projectId: "project-a" },
    ]);
    expect(JSON.stringify(actions.view)).not.toContain("secret");
    await expect(actions.run("custom:local", "C:/repo-b", "project-b")).rejects.toThrow("different Project");
    expect(launch).not.toHaveBeenCalled();

    await actions.run("custom:local", "C:/space 'quoted'; $literal", "project-a");
    const [, args] = launch.mock.calls[0]!;
    expect(args.slice(0, 3)).toEqual(["-w", "new", "new-tab"]);
    expect(args).toContain("-NoExit");
    const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    expect(script).toBe("Set-Location -LiteralPath 'C:/space ''quoted''; $literal' -ErrorAction Stop\ngit -C 'C:/space ''quoted''; $literal' status");
    expect(args.join(" ")).not.toContain("$literal");
  });

  it("uses current saved commands rather than trusting a stale menu", async () => {
    let commands: DesktopCommandAction[] = [{ id: "dev", label: "Dev", command: "old-command" }];
    const { actions, launch } = await registry(() => commands);
    commands = [{ id: "dev", label: "Renamed", command: "new-command", projectId: "project-b" }];
    expect(actions.view.find((action) => action.id === "custom:dev")?.label).toBe("Renamed");
    await expect(actions.run("custom:dev", "C:/repo-a", "project-a")).rejects.toThrow("different Project");
    await actions.run("custom:dev", "C:/repo-b", "project-b");
    expect(Buffer.from(launch.mock.calls[0]![1].at(-1)!, "base64").toString("utf16le")).toContain("new-command");
    commands = [];
    await expect(actions.run("custom:dev", "C:/repo-b", "project-b")).rejects.toThrow("no longer available");
  });

  it("keeps configured commands visible without terminal prerequisites and reports failure without command text", async () => {
    const command = { id: "dev", label: "Dev", command: "token=secret" };
    const missing = await registry(() => [command], []);
    expect(missing.actions.view.some((action) => action.id === "custom:dev")).toBe(true);
    await expect(missing.actions.run("custom:dev", "C:/repo", "project-a")).rejects.toThrow("Windows Terminal");
    expect(missing.launch).not.toHaveBeenCalled();

    const failed = await registry(() => [command]);
    failed.launch.mockRejectedValueOnce(new Error("token=secret"));
    await expect(failed.actions.run("custom:dev", "C:/repo", "project-a")).rejects.toThrow("Could not open a new terminal window");
  });
});

describe("command settings", () => {
  it("persists global/project scope in the existing user settings store", async () => {
    const root = await mkdtemp(join(tmpdir(), "frostpi-action-settings-"));
    directories.push(root);
    const path = join(root, "settings.json");
    const store = await DesktopSettingsStore.open(path);
    const commands = [
      { id: "global", label: "Git", command: "lazygit" },
      { id: "project", label: "Dev", command: "pnpm dev", projectId: "project-a" },
    ];
    await store.replace({ "desktop.actions": commands });
    expect((await DesktopSettingsStore.open(path)).values["desktop.actions"]).toEqual(commands);
    for (const invalid of [
      [{ id: "bad", label: " ", command: "secret" }],
      [{ id: "bad", label: "Bad", command: "secret\0" }],
      [{ id: "bad", label: "Bad", command: "secret", cwd: "C:/injected" }],
      [{ id: "bad", label: "Bad", command: "secret", projectId: 42 }],
      [{ id: "same", label: "A", command: "secret" }, { id: "same", label: "B", command: "secret" }],
    ]) {
      await expect(store.replace({ "desktop.actions": invalid })).rejects.not.toThrow("secret");
      expect(store.values["desktop.actions"]).toEqual(commands);
    }
  });
});
