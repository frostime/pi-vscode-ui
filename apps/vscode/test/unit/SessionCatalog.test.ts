import { appendFile, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  window: {
    createQuickPick: vi.fn(),
  },
  ProgressLocation: { Window: 10 },
  QuickPickItemKind: { Separator: -1 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  commands: { executeCommand: vi.fn() },
}));

import { QuickPickItemKind } from "vscode";
import { discoverPiSessions, prioritizeSessionRoots, readPiSessionMetadata, resolveSessionRoots } from "../../src/extension/sessions/catalog/SessionCatalog.js";
import { buildSessionQuickPickItems } from "../../src/extension/sessions/catalog/SessionCatalogPicker.js";
import { sessionPathKey, type SessionFileScanResult } from "../../src/extension/sessions/catalog/SessionFileScanner.js";
import type { SessionWorkingDirectory } from "../../src/extension/sessions/SessionWorkingDirectories.js";

describe("Pi session metadata", () => {
  it("reads cwd, session name, and latest user preview from JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-session-"));
    const path = join(dir, "sample.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "session-id", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Inspect the authentication flow" }] } }),
      JSON.stringify({ type: "session_info", name: "Auth audit" }),
    ].join("\n"));

    const entry = await readPiSessionMetadata(path);
    expect(entry).toMatchObject({ path, cwd: dir, title: "Auth audit", sessionId: "session-id", preview: "Inspect the authentication flow" });
  });

  it("rejects arbitrary JSONL files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-session-"));
    const path = join(dir, "not-session.jsonl");
    await writeFile(path, JSON.stringify({ type: "event", cwd: dir }));
    expect(await readPiSessionMetadata(path)).toBeUndefined();
  });

  it("keeps an early auto-name when later transcript pushes it out of the tail window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-session-"));
    const path = join(dir, "auto-named.jsonl");
    const pad = "x".repeat(8_000);
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "early-name", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "first prompt" }] } }),
      JSON.stringify({ type: "session_info", name: "26-07-18T14:30_自动标题" }),
    ];
    // ~400 KiB of later turns so the name sits only in the head window.
    for (let i = 0; i < 55; i += 1) {
      lines.push(JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: `follow-up ${i} ${pad}` }] },
      }));
    }
    await writeFile(path, lines.join("\n"));

    const entry = await readPiSessionMetadata(path);
    expect(entry?.title).toBe("26-07-18T14:30_自动标题");
  });

  it("prefers a later rename over an earlier session_info", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-session-"));
    const path = join(dir, "renamed.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "rename", cwd: dir }),
      JSON.stringify({ type: "session_info", name: "Old title" }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "continue" }] } }),
      JSON.stringify({ type: "session_info", name: "New title" }),
    ].join("\n"));

    expect((await readPiSessionMetadata(path))?.title).toBe("New title");
  });

  it("treats an empty latest session_info name as cleared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-session-"));
    const path = join(dir, "cleared.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "clear", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "fallback preview" }] } }),
      JSON.stringify({ type: "session_info", name: "Named" }),
      JSON.stringify({ type: "session_info", name: "   " }),
    ].join("\n"));

    expect((await readPiSessionMetadata(path))?.title).toBe("fallback preview");
  });
});

describe("session discovery across worktrees", () => {
  it("uses a complete fast scan without reading transcript previews", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-fast-session-"));
    const path = join(dir, "middle-title.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "fast", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: "preview omitted on fast path" } }),
      JSON.stringify({ type: "session_info", name: "Fast title" }),
    ].join("\n"));
    const directories = [workingDirectory(dir)];

    const sessions = await discoverPiSessions(
      directories,
      [],
      () => Promise.resolve([dir]),
      () => completeScan(path, dir, { name: "Fast title" }),
    );

    expect(sessions).toMatchObject([{ path, cwd: dir, title: "Fast title", sessionId: "fast" }]);
    expect(sessions[0]?.preview).toBeUndefined();
  });

  it("uses the existing preview fallback when a fast scan finds no title", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-fallback-session-"));
    const path = join(dir, "untitled.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "untitled", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Fallback preview" } }),
    ].join("\n"));

    const sessions = await discoverPiSessions(
      [workingDirectory(dir)],
      [],
      () => Promise.resolve([dir]),
      () => completeScan(path, dir),
    );

    expect(sessions[0]).toMatchObject({ title: "Fallback preview", preview: "Fallback preview" });
  });

  it("uses the existing bounded reader when the fast scanner rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-incomplete-scan-"));
    const path = join(dir, "fallback.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "fallback", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Existing fallback" } }),
      JSON.stringify({ type: "session_info", name: "Existing title" }),
    ].join("\n"));

    const sessions = await discoverPiSessions(
      [workingDirectory(dir)],
      [],
      () => Promise.resolve([dir]),
      () => Promise.reject(new Error("scanner failed")),
    );

    expect(sessions[0]).toMatchObject({ title: "Existing title", preview: "Existing fallback" });
  });

  it("does not restore an old title after a fast scan sees an explicit clear", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-cleared-session-"));
    const path = join(dir, "cleared.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "cleared", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Cleared fallback" } }),
      JSON.stringify({ type: "session_info", name: "Old title" }),
    ].join("\n"));

    const sessions = await discoverPiSessions(
      [workingDirectory(dir)],
      [],
      () => Promise.resolve([dir]),
      () => completeScan(path, dir, { name: undefined }),
    );

    expect(sessions[0]).toMatchObject({ title: "Cleared fallback", preview: "Cleared fallback" });
  });

  it("falls back when a live session changes after the fast scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-changing-session-"));
    const path = join(dir, "changing.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "changing", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Preview" } }),
      JSON.stringify({ type: "session_info", name: "   " }),
    ].join("\n"));
    const scannedBytes = (await stat(path)).size;

    const sessions = await discoverPiSessions(
      [workingDirectory(dir)],
      [],
      () => Promise.resolve([dir]),
      async () => {
        await appendFile(path, `\n${JSON.stringify({ type: "session_info", name: "Appended title" })}`);
        return {
          complete: true,
          sessions: new Map([[sessionPathKey(path), {
            cwd: dir,
            bytesScanned: scannedBytes,
            sessionInfo: { name: undefined },
          }]]),
        };
      },
    );

    expect(sessions[0]?.title).toBe("Appended title");
  });

  it("prioritizes linked-worktree roots before current and shared roots", () => {
    const main = resolve("/repo");
    const linkedA = resolve("/worktrees/a");
    const linkedB = resolve("/worktrees/b");
    const directories: SessionWorkingDirectory[] = [
      { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", isCurrent: true },
      { cwd: linkedA, workspaceFolderCwd: main, worktreeRoot: linkedA, directoryName: "a", isCurrent: false },
      { cwd: linkedB, workspaceFolderCwd: main, worktreeRoot: linkedB, directoryName: "b", isCurrent: false },
    ];
    const shared = resolve("/sessions/shared");
    const linkedShared = resolve("/sessions/linked-shared");

    expect(prioritizeSessionRoots(directories, [
      [resolve("/sessions/main"), shared],
      [resolve("/sessions/a"), shared, linkedShared],
      [resolve("/sessions/b"), shared, linkedShared],
    ])).toEqual([
      resolve("/sessions/a"),
      resolve("/sessions/b"),
      resolve("/sessions/main"),
      shared,
      linkedShared,
    ]);
  });

  it("resolves project session roots for every allowed working directory", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-main-worktree-"));
    const linked = await mkdtemp(join(tmpdir(), "frostpi-linked-worktree-"));
    for (const [cwd, title] of [[main, "Main session"], [linked, "Linked session"]] as const) {
      const sessionDir = join(cwd, ".pi", "sessions");
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));
      await writeFile(join(sessionDir, `${title}.jsonl`), [
        JSON.stringify({ type: "session", version: 3, id: title, cwd }),
        JSON.stringify({ type: "session_info", name: title }),
      ].join("\n"));
    }
    const directories: SessionWorkingDirectory[] = [
      { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true },
      { cwd: linked, workspaceFolderCwd: main, worktreeRoot: linked, directoryName: "linked", branch: "feature", isCurrent: false },
    ];

    const sessions = await discoverPiSessions(
      directories,
      [],
      (cwd) => Promise.resolve([join(cwd, ".pi", "sessions")]),
    );
    const quickPickItems = buildSessionQuickPickItems(sessions, directories);
    const separatorLabels = quickPickItems.filter((item) => item.kind === QuickPickItemKind.Separator).map((item) => item.label);
    const sessionLabels = quickPickItems.filter((item) => item.entry).map((item) => item.label);

    expect(new Set(sessions.map((session) => session.title))).toEqual(new Set(["Main session", "Linked session"]));
    expect(separatorLabels).toEqual([
      "Worktree · feature · linked",
      "Current workspace · main",
    ]);
    expect(sessionLabels).toEqual([
      "$(git-branch) Linked session",
      "$(comment-discussion) Main session",
    ]);
    expect(quickPickItems.find((item) => item.label === "$(comment-discussion) Main session")?.description)
      .toContain("main · main");
    expect(quickPickItems.find((item) => item.label === "$(git-branch) Linked session")?.description)
      .toContain("feature · linked");
  });

  it("orders linked worktree groups by latest session before the current workspace", () => {
    const main = resolve("/repo");
    const olderLinked = resolve("/worktrees/older");
    const newerLinked = resolve("/worktrees/newer");
    const directories: SessionWorkingDirectory[] = [
      { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "repo", branch: "main", isCurrent: true },
      { cwd: olderLinked, workspaceFolderCwd: main, worktreeRoot: olderLinked, directoryName: "older", branch: "old-feature", isCurrent: false },
      { cwd: newerLinked, workspaceFolderCwd: main, worktreeRoot: newerLinked, directoryName: "newer", branch: "new-feature", isCurrent: false },
    ];
    const sessions = [
      { path: "/s/main.jsonl", cwd: main, title: "Main", updatedAt: 300 },
      { path: "/s/old.jsonl", cwd: olderLinked, title: "Older linked", updatedAt: 100 },
      { path: "/s/new.jsonl", cwd: newerLinked, title: "Newer linked", updatedAt: 200 },
    ];

    const labels = buildSessionQuickPickItems(sessions, directories)
      .filter((item) => item.kind === QuickPickItemKind.Separator || item.entry)
      .map((item) => item.label);

    expect(labels).toEqual([
      "Worktree · new-feature · newer",
      "$(git-branch) Newer linked",
      "Worktree · old-feature · older",
      "$(git-branch) Older linked",
      "Current workspace · main",
      "$(comment-discussion) Main",
    ]);
  });
});

function workingDirectory(cwd: string): SessionWorkingDirectory {
  return { cwd, workspaceFolderCwd: cwd, worktreeRoot: cwd, directoryName: "workspace", isCurrent: true };
}

async function completeScan(
  path: string,
  cwd: string,
  sessionInfo?: { name: string | undefined },
): Promise<SessionFileScanResult> {
  return {
    complete: true,
    sessions: new Map([[sessionPathKey(path), {
      cwd,
      bytesScanned: (await stat(path)).size,
      sessionId: sessionInfo ? "fast" : "untitled",
      ...(sessionInfo ? { sessionInfo } : {}),
    }]]),
  };
}

describe("session root resolution", () => {
  it("resolves project sessionDir relative to the workspace cwd, not the settings file directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-roots-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));

    const roots = await resolveSessionRoots(cwd, []);
    expect(roots).toContain(normalize(resolve(cwd, ".pi", "sessions")));
    expect(roots).not.toContain(normalize(resolve(cwd, ".pi", ".pi", "sessions")));
  });

  it("resolves a bare relative project sessionDir against the workspace cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-roots-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "sessions" }));

    const roots = await resolveSessionRoots(cwd, []);
    expect(roots).toContain(normalize(resolve(cwd, "sessions")));
  });

  it("resolves --session-dir against the workspace cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-roots-"));
    const roots = await resolveSessionRoots(cwd, ["--session-dir", "custom-sessions"]);
    expect(roots).toContain(normalize(resolve(cwd, "custom-sessions")));
  });
});
