import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), renames: [] as string[] }));

vi.mock("vscode", () => {
  class FileSystemError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  const resolve = (path: string): string => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") parts.pop();
      else if (part) parts.push(part);
    }
    return `/${parts.join("/")}`;
  };
  const uri = (path: string) => ({ path: resolve(path), toString: () => resolve(path) });
  return {
    FileSystemError,
    Uri: {
      file: (path: string) => uri(path),
      joinPath: (base: { path: string }, ...parts: string[]) => uri([base.path, ...parts].join("/")),
    },
    workspace: {
      fs: {
        createDirectory: vi.fn(() => Promise.resolve()),
        readFile: vi.fn((file: { path: string }) => {
          const bytes = disk.files.get(file.path);
          return bytes ? Promise.resolve(bytes) : Promise.reject(new FileSystemError("FileNotFound"));
        }),
        writeFile: vi.fn((file: { path: string }, bytes: Uint8Array) => {
          disk.files.set(file.path, bytes);
          return Promise.resolve();
        }),
        rename: vi.fn((from: { path: string }, to: { path: string }) => {
          const bytes = disk.files.get(from.path);
          if (!bytes) return Promise.reject(new FileSystemError("FileNotFound"));
          disk.files.delete(from.path);
          disk.files.set(to.path, bytes);
          disk.renames.push(to.path);
          return Promise.resolve();
        }),
      },
    },
  };
});

const vscode = await import("vscode");
const { WorkspaceFileMemento } = await import("../../src/extension/storage/WorkspaceFileMemento.js");

const STORAGE = vscode.Uri.file("/remote/.vscode-server/data/User/workspaceStorage/abc/frostime.frostpi");
const STATE_FILE = "/remote/.vscode-server/data/User/workspaceStorage/abc/frostime.frostpi/frostpi-state.json";

function workspaceState(values: Record<string, unknown> = {}) {
  const update = vi.fn<(key: string, value: unknown) => Promise<void>>(() => Promise.resolve());
  return { get: <T>(key: string) => values[key] as T | undefined, update };
}

function stored(): unknown {
  return JSON.parse(new TextDecoder().decode(disk.files.get(STATE_FILE)));
}

beforeEach(() => {
  disk.files.clear();
  disk.renames.length = 0;
});

describe("FrostPi workspace state on the Extension Host's machine", () => {
  it("reads a list VS Code kept until the first save moves it to the file, and never writes VS Code's copy", async () => {
    const legacy = { version: 1, activeSessionId: "a", sessions: [] };
    const fallback = workspaceState({ "frostpi.sessions.v1": legacy });
    const logger = { error: vi.fn() };
    const memento = await WorkspaceFileMemento.open(STORAGE, fallback, logger);

    expect(memento.get("frostpi.sessions.v1")).toEqual(legacy);
    const saved = { version: 1, activeSessionId: "b", sessions: [] };
    await memento.update("frostpi.sessions.v1", saved);
    expect(stored()).toEqual({ "frostpi.sessions.v1": saved });
    expect(disk.renames).toEqual([STATE_FILE]);
    expect(fallback.update).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    // A new window, or another computer opening the same remote folder, reads the file.
    const other = await WorkspaceFileMemento.open(STORAGE, workspaceState({ "frostpi.sessions.v1": legacy }), logger);
    expect(other.get("frostpi.sessions.v1")).toEqual(saved);
  });

  it("keeps the last of overlapping saves", async () => {
    const memento = await WorkspaceFileMemento.open(STORAGE, workspaceState(), { error: vi.fn() });
    await Promise.all([memento.update("key", 1), memento.update("key", 2), memento.update("other", "x")]);
    expect(stored()).toEqual({ key: 2, other: "x" });
    expect(memento.get("key")).toBe(2);
  });

  it("uses VS Code's state without workspace storage, and until the next save when the file is unreadable", async () => {
    const fallback = workspaceState({ key: "kept" });
    expect(await WorkspaceFileMemento.open(undefined, fallback, { error: vi.fn() })).toBe(fallback);

    disk.files.set(STATE_FILE, new TextEncoder().encode("{ not json"));
    const logger = { error: vi.fn() };
    const memento = await WorkspaceFileMemento.open(STORAGE, fallback, logger);
    expect(memento.get("key")).toBe("kept");
    expect(logger.error).toHaveBeenCalledOnce();
    await memento.update("key", "new");
    expect(stored()).toEqual({ key: "new" });
  });
});
