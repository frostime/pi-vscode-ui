import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ openDialog: vi.fn() }));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: native.openDialog },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

import type { FrostPiConfiguration } from "@frostime/pi-client/core/configuration/configurationTypes";
import type { HostInputBoxOptions, HostQuickPickItem, HostQuickPickOptions, HostQuickPickSeparator } from "@frostime/pi-client/host";
import { SessionRegistry } from "@frostime/pi-client/host/SessionRegistry";
import { readConfiguration } from "@frostime/pi-client/host/readConfiguration";
import { readChatTypography } from "@frostime/pi-client/host/readChatTypography";
import { workspaceFileExcludeRules } from "@frostime/pi-client/host/file-search/mentionSearchContext";

import type { DesktopInteractions } from "../src/main/dialogs.js";
import { createDesktopHost as createHost, type DesktopHostOptions } from "../src/main/desktopHost.js";
import { electronNative } from "../src/main/electronNative.js";
import type { BrowserWindow } from "electron";
function createDesktopHost(options: Omit<DesktopHostOptions, "native"> & { window: BrowserWindow | (() => BrowserWindow | null) }) {
  return createHost({ ...options, native: electronNative(() => { const w = typeof options.window === "function" ? options.window() : options.window; return w && !w.isDestroyed() ? w : undefined; }) });
}
import { DesktopProjects } from "../src/main/desktopProjects.js";
import { DesktopSettingsStore } from "../src/main/settings/DesktopSettingsStore.js";
import { DESKTOP_CLIENT_UI_CAPABILITIES } from "../src/shared/desktopCapabilities.js";
import type { DesktopSettingsTarget } from "../src/shared/desktopSettings.js";

/** Property-shaped structural stub; methods would trip the unbound-method lint rule on mock refs. */
interface StubInteractions {
  showQuickPick(
    items: readonly (HostQuickPickItem | HostQuickPickSeparator)[],
    options?: HostQuickPickOptions,
  ): Promise<HostQuickPickItem | undefined>;
  showInputBox(options?: HostInputBoxOptions): Promise<string | undefined>;
}

function interactions(overrides: Partial<StubInteractions> = {}): StubInteractions {
  return {
    showQuickPick: vi.fn((items: readonly (HostQuickPickItem | HostQuickPickSeparator)[]) =>
      Promise.resolve(items[0] as HostQuickPickItem | undefined)),
    showInputBox: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  };
}

async function projectsWithRoots(roots: string[]): Promise<DesktopProjects> {
  const projects = new DesktopProjects();
  for (const root of roots) await projects.addProject(root);
  return projects;
}

describe("createDesktopHost", () => {
  it("uses the product's real UI declaration and does not pretend unsupported editor/export operations exist", () => {
    const host = createDesktopHost({ window: () => null, projects: new DesktopProjects(), interactions: interactions() as unknown as DesktopInteractions });
    // Independent of synthetic all-false DOM tests: this checks the actual Desktop assembly.
    expect(host.capabilities).toBe(DESKTOP_CLIENT_UI_CAPABILITIES);
    expect(host.capabilities).toEqual({ sessionEditorTabs: false, editorMentionSpecials: false, openReferencedLocation: true, exportDiagnostics: false });
    expect(typeof host.editor.openReferencedLocation).toBe("function");
    expect("exportDiagnostics" in host).toBe(false);
  });

  it("routes supported settings actions to known fields and explicitly rejects unsupported search queries", async () => {
    const targets: DesktopSettingsTarget[] = [];
    const host = createDesktopHost({
      window: () => null, projects: new DesktopProjects(), interactions: interactions() as unknown as DesktopInteractions,
      openSettings: (target) => { targets.push(target); return Promise.resolve(); },
    });
    await host.editor.openSettings!("@ext:frostime.frostpi");
    await host.editor.openProxySettings!();
    await host.editor.configurePiExecutable!();
    expect(targets).toEqual(["all", "frostpi.network.proxy.mode", "frostpi.pi.executable"]);
    expect(() => host.editor.openSettings!("not-a-supported-query")).toThrow("not supported");
    expect(targets).toHaveLength(3);
  });

  it("translates VS Code file filters to Electron's native dialog shape", async () => {
    const window = { isDestroyed: () => false };
    native.openDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/selected/session.jsonl"] });
    const host = createDesktopHost({
      window: window as never,
      projects: new DesktopProjects(),
      interactions: interactions() as unknown as DesktopInteractions,
    });
    const selected = await host.window.showOpenFileDialog!({ title: "Resume", filters: { "Pi session": ["jsonl"] } });
    expect(native.openDialog).toHaveBeenCalledWith(window, {
      title: "Resume", properties: ["openFile"], filters: [{ name: "Pi session", extensions: ["jsonl"] }],
    });
    expect(selected?.[0]?.fsPath).toBe("/selected/session.jsonl");
  });

  it("rejects the VS Code proxy mode explicitly (prefixed or bare key)", async () => {
    const projects = await projectsWithRoots([await mkdtemp(join(tmpdir(), "frostpi-host-"))]);
    expect(() => createDesktopHost({
      window: () => null,
      projects,
      interactions: interactions() as unknown as DesktopInteractions,
      settings: { "frostpi.network.proxy.mode": "vscode" },
    })).toThrow("'vscode' requires VS Code");

    expect(() => createDesktopHost({
      window: () => null,
      projects,
      interactions: interactions() as unknown as DesktopInteractions,
      settings: { "network.proxy.mode": "vscode" },
    })).toThrow("'vscode' requires VS Code");
  });

  it("applies setting overrides over shared defaults without duplicating defaults", async () => {
    const projects = await projectsWithRoots([await mkdtemp(join(tmpdir(), "frostpi-host-"))]);
    const host = createDesktopHost({
      window: () => null,
      projects,
      interactions: interactions() as unknown as DesktopInteractions,
      settings: {
        "frostpi.pi.executable": "/pi/cli.js",
        "frostpi.session.startOnOpen": false,
      },
    });
    const configuration: FrostPiConfiguration = readConfiguration(host, "C:/projects/alpha");

    expect(configuration.piExecutable).toBe("/pi/cli.js");
    expect(configuration.startSessionOnOpen).toBe(false);
    // Everything else comes from the shared defaults — Desktop defines none itself.
    expect(configuration.runtimeCompatibility).toBe("pi");
    expect(configuration.diagnosticsLevel).toBe("info");
    expect(configuration.proxy.mode).toBe("inherit");
    expect(configuration.maxImageBytes).toBe(10 * 1024 * 1024);
  });

  it("passes 'custom' proxy through shared readConfiguration; only 'vscode' is a Desktop incompatibility", async () => {
    const projects = await projectsWithRoots([await mkdtemp(join(tmpdir(), "frostpi-host-"))]);
    const host = createDesktopHost({
      window: () => null,
      projects,
      interactions: interactions() as unknown as DesktopInteractions,
      settings: { "frostpi.network.proxy.mode": "custom", "frostpi.network.proxy.endpoint": "http://127.0.0.1:9000" },
    });
    expect(readConfiguration(host).proxy).toEqual({
      mode: "custom",
      endpoint: "http://127.0.0.1:9000",
      noProxy: "localhost,127.0.0.1,::1",
    });
  });

  it("reads live dot-key settings, merges exclusion defaults and persists native-shaped updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "frostpi-live-settings-"));
    try {
      const store = await DesktopSettingsStore.open(join(root, "settings.json"));
      await store.replace({
        "chat.fontSize": 18,
        "files.exclude": { "**/generated": true, "**/.svn": false },
        "search.exclude": { "**/cache": true },
      });
      const host = createDesktopHost({
        window: () => null, projects: new DesktopProjects(),
        interactions: interactions() as unknown as DesktopInteractions, settingsStore: store,
      });
      const chat = host.configuration.getConfiguration("chat");
      expect(readChatTypography(chat)).toEqual({ message: { fontSize: 18 }, composer: { fontSize: 14 } });
      await chat.update("editor.fontSize", 17, "global");
      expect(readChatTypography(chat).composer.fontSize).toBe(17);
      expect((await DesktopSettingsStore.open(store.filePath)).values["chat.editor.fontSize"]).toBe(17);
      const patterns = (respectSearch: boolean) => workspaceFileExcludeRules(host, root, respectSearch).map((rule) => rule.pattern);
      expect(patterns(true)).toEqual(expect.arrayContaining(["**/generated", "**/cache", "**/.hg", "**/bower_components"]));
      expect(patterns(true)).not.toContain("**/.svn");
      expect(patterns(false)).not.toContain("**/cache");
      await store.update("files.exclude", { "**/new-build": true });
      expect(patterns(false)).toContain("**/new-build");
      expect(patterns(false)).not.toContain("**/generated");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps every Project root stable in workspaceFolders while the anchor switches", async () => {
    const alpha = await mkdtemp(join(tmpdir(), "frostpi-host-alpha-"));
    const beta = await mkdtemp(join(tmpdir(), "frostpi-host-beta-"));
    const projects = await projectsWithRoots([alpha, beta]);
    const host = createDesktopHost({ window: () => null, projects, interactions: interactions() as unknown as DesktopInteractions });
    const logged: string[] = [];
    const registry = new SessionRegistry(host, { logger: {
      error: (message) => logged.push(message),
      info: (message) => logged.push(message),
    } });
    try {
      const folders = () => host.workspace.getWorkspaceFolders().map((folder) => folder.uri.fsPath);
      expect(folders()).toEqual([alpha, beta]);

      // First Project is the initial anchor; snapshot reports it as the workspace.
      expect(host.workspace.activeWorkspaceFolder()?.uri.fsPath).toBe(alpha);
      expect(registry.snapshot().workspacePath).toBe(alpha);
      expect(registry.snapshot().workspaceName).toBe(alpha.split(/[\\/]/).at(-1));

      projects.selectProject(projects.list()[1]!.id);
      expect(folders()).toEqual([alpha, beta]); // roots never follow the anchor
      expect(registry.snapshot().workspacePath).toBe(beta);

      projects.selectProject(null);
      expect(host.workspace.activeWorkspaceFolder()).toBeUndefined();
      expect(folders()).toEqual([alpha, beta]);
    } finally {
      await registry.dispose();
    }
  });

});

describe("desktop host workspace mapping", () => {
  it("canonicalizes project roots so alias spellings surface one stable cwd", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-host-alias-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");

    const projects = await projectsWithRoots([target, alias]);
    const host = createDesktopHost({ window: () => null, projects, interactions: interactions() as unknown as DesktopInteractions });
    expect(host.workspace.getWorkspaceFolders()).toHaveLength(1);
    expect(host.workspace.getWorkspaceFolders()[0]?.uri.fsPath).toBe(target);
  });
});
