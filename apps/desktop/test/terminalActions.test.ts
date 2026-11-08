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

  it.each([
    { tools: ["wt.exe", "pwsh.exe", "powershell.exe"], shell: "pwsh.exe", terminal: true },
    { tools: ["wt.exe", "powershell.exe"], shell: "powershell.exe", terminal: true },
    { tools: ["pwsh.exe", "powershell.exe"], shell: "pwsh.exe", terminal: false },
    { tools: ["powershell.exe"], shell: "powershell.exe", terminal: false },
  ])("selects $shell with Windows Terminal=$terminal from available tools", async ({ tools, shell, terminal }) => {
    const { actions, launch } = await registry(() => [{ id: "dev", label: "Dev", command: "Get-Location" }], tools);
    // Repeated launches target the same named window, not a fresh or most-recent user window.
    await actions.run("custom:dev", "C:/repo");
    await actions.run("custom:dev", "C:/repo");
    expect(launch).toHaveBeenCalledTimes(2);
    for (const [executable, args] of launch.mock.calls) {
      expect(executable).toBe(join("C:/Tools", terminal ? "wt.exe" : shell));
      const prefix = terminal ? ["-w", "FrostPi", "new-tab", join("C:/Tools", shell)] : [];
      expect(args).toEqual([...prefix, "-NoLogo", "-NoExit", "-EncodedCommand", expect.any(String)]);
      expect(Buffer.from(args.at(-1)!, "base64").toString("utf16le"))
        .toBe("Set-Location -LiteralPath 'C:/repo' -ErrorAction Stop\nGet-Location");
    }
  });

  it("shows lazygit when the tool and either PowerShell are available, without requiring Windows Terminal", async () => {
    const available = await registry(() => [], ["wt.exe", "powershell.exe", "lazygit.exe"]);
    expect(available.actions.view).toContainEqual({ id: "lazygit", label: "lazygit", icon: "codicon-globe", section: "actions", scope: "global" });
    await available.actions.run("lazygit", "C:/repo");
    expect(available.launch).toHaveBeenCalledOnce();
    const script = Buffer.from(available.launch.mock.calls[0]![1].at(-1)!, "base64").toString("utf16le");
    expect(script).toContain("-LiteralPath 'C:/repo'");
    expect(script).toMatch(/& '.*lazygit\.exe'/u);

    const direct = await registry(() => [], ["pwsh.exe", "lazygit.exe"]);
    expect(direct.actions.view.some((action) => action.id === "lazygit")).toBe(true);
    await direct.actions.run("lazygit", "C:/repo");
    expect(basename(direct.launch.mock.calls[0]![0])).toBe("pwsh.exe");

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
    expect(args.slice(0, 3)).toEqual(["-w", "FrostPi", "new-tab"]);
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
    await expect(missing.actions.run("custom:dev", "C:/repo", "project-a")).rejects.toThrow("PowerShell");
    expect(missing.launch).not.toHaveBeenCalled();
  });

  it.each([
    { tools: ["wt.exe", "pwsh.exe", "powershell.exe"] },
    { tools: ["pwsh.exe", "powershell.exe"] },
  ])("does not retry with another host or shell after a launch failure ($tools)", async ({ tools }) => {
    const failed = await registry(() => [{ id: "dev", label: "Dev", command: "token=secret" }], tools);
    failed.launch.mockRejectedValueOnce(new Error("token=secret"));
    await expect(failed.actions.run("custom:dev", "C:/repo", "project-a")).rejects.toThrow(/^Could not start the terminal for this Action\.$/u);
    expect(failed.launch).toHaveBeenCalledOnce();
  });
});

describe("command settings", () => {
  it("keeps an unfinished Action in the menu and refuses to run it", async () => {
    const { actions, launch } = await registry(() => [{ id: "draft", label: " ", command: "" }]);

    expect(actions.view.map(({ id, label }) => ({ id, label }))).toContainEqual({ id: "custom:draft", label: "Unnamed Action" });
    await expect(actions.run("custom:draft", "C:/repo")).rejects.toThrow("This Action has no command");
    expect(launch).not.toHaveBeenCalled();
  });

  it("runs an unnamed Action that has a command", async () => {
    const { actions, launch } = await registry(() => [{ id: "anon", label: "", command: "pnpm dev" }]);

    expect(actions.view.map(({ id, label }) => ({ id, label }))).toContainEqual({ id: "custom:anon", label: "Unnamed Action" });
    await actions.run("custom:anon", "C:/repo");
    expect(launch).toHaveBeenCalledOnce();
  });

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
    // An unfinished Action is the user's own draft: it is saved, and it fails only when run.
    const draft = [{ id: "draft", label: " ", command: "" }];
    await store.replace({ "desktop.actions": [...commands, ...draft] });
    expect((await DesktopSettingsStore.open(path)).values["desktop.actions"]).toEqual([...commands, ...draft]);
    await store.replace({ "desktop.actions": commands });
    for (const invalid of [
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
