import { access, appendFile, mkdir, mkdtemp, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discoverPiSessions, prioritizeSessionRoots, readPiSessionMetadata, resolveSessionRoots } from "../../src/host/catalog/SessionCatalog.js";
import { buildSessionQuickPickItems } from "../../src/host/catalog/SessionCatalogPicker.js";
import { sessionPathKey, type SessionFileScanResult } from "../../src/host/catalog/SessionFileScanner.js";
import type { SessionWorkingDirectory } from "../../src/host/sessions/SessionWorkingDirectories.js";

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
  it.each(["bounded reader", "fast scan"])("keeps and groups alias-spelled sessions from the %s", async (source) => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-session-alias-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const path = join(target, "session.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "alias", cwd: alias }),
      JSON.stringify({ type: "session_info", name: "Alias session" }),
    ].join("\n"));
    const directories = [workingDirectory(target)];

    const sessions = await discoverPiSessions(
      directories,
      [],
      "pi",
      () => Promise.resolve([target]),
      () => source === "fast scan"
        ? completeScan(path, alias, { name: "Alias session" })
        : Promise.resolve({ complete: false }),
    );

    expect(sessions).toMatchObject([{ path, cwd: alias, title: "Alias session" }]);
    expect(buildSessionQuickPickItems(sessions, directories).map((item) => item.entry).filter(Boolean)).toEqual(sessions);
  });

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
      "pi",
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
      "pi",
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
      "pi",
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
      "pi",
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
      "pi",
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
      "pi",
      (cwd) => Promise.resolve([join(cwd, ".pi", "sessions")]),
    );
    const quickPickItems = buildSessionQuickPickItems(sessions, directories);
    const separatorLabels = quickPickItems.filter((item) => item.kind === "separator").map((item) => item.label);
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
      .filter((item) => item.kind === "separator" || item.entry)
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
  let cwd: string;
  let agentDirectory: string;

  beforeEach(async () => {
    const parent = await mkdtemp(join(tmpdir(), "frostpi-roots-"));
    cwd = join(parent, "project");
    agentDirectory = join(parent, "agent");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDirectory);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDirectory);
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("resolves project sessionDir relative to the workspace cwd, not the settings file directory", async () => {
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));

    expect(await resolveSessionRoots(cwd, [])).toEqual([join(cwd, ".pi", "sessions")]);
  });

  it("selects only the highest-priority configured directory", async () => {
    await writeFile(join(agentDirectory, "settings.json"), JSON.stringify({ sessionDir: "user-sessions" }));
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "project-sessions" }));
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", "env-sessions");

    expect(await resolveSessionRoots(cwd, ["--session-dir", "cli-sessions"]))
      .toEqual([join(cwd, "cli-sessions")]);
    expect(await resolveSessionRoots(cwd, ["--session-dir=cli-sessions"]))
      .toEqual([join(cwd, "cli-sessions")]);
    expect(await resolveSessionRoots(cwd, [])).toEqual([join(cwd, "env-sessions")]);

    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", undefined);
    expect(await resolveSessionRoots(cwd, [])).toEqual([join(cwd, "project-sessions")]);

    await writeFile(join(cwd, ".pi", "settings.json"), "{}");
    expect(await resolveSessionRoots(cwd, [])).toEqual([join(cwd, "user-sessions")]);
  });

  it("expands home-relative custom directories without adding a cwd suffix", async () => {
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "~/frostpi-test-sessions" }));

    expect(await resolveSessionRoots(cwd, [])).toEqual([join(homedir(), "frostpi-test-sessions")]);
  });

  it("matches Pi's default cwd encoding without creating the session directory", async () => {
    const sampleCwd = process.platform === "win32"
      ? "C:/__frostpi_catalog_test__/My Project/nested/"
      : "/__frostpi_catalog_test__/My Project/nested/";
    const encodedCwd = process.platform === "win32"
      ? "--C--__frostpi_catalog_test__-My Project-nested--"
      : "--__frostpi_catalog_test__-My Project-nested--";
    const expected = join(agentDirectory, "sessions", encodedCwd);

    expect(await resolveSessionRoots(sampleCwd, [])).toEqual([expected]);
    await expect(access(expected)).rejects.toThrow();
  });

  it("scans only each worktree's effective directory, not unrelated or old locations", async () => {
    const linked = join(cwd, "linked");
    const linkedSessionDir = join(linked, ".pi", "sessions");
    await mkdir(linkedSessionDir, { recursive: true });
    await writeFile(join(linked, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));
    const mainSessionDir = (await resolveSessionRoots(cwd, []))[0]!;
    expect(mainSessionDir).not.toBe(join(agentDirectory, "sessions"));
    await mkdir(mainSessionDir, { recursive: true });
    const oldSessionDir = join(agentDirectory, "sessions", "other-project");
    await mkdir(oldSessionDir, { recursive: true });
    for (const [directory, owner, title] of [
      [mainSessionDir, cwd, "Main"],
      [linkedSessionDir, linked, "Linked"],
      [oldSessionDir, cwd, "Old location"],
      [oldSessionDir, join(cwd, "unrelated"), "Unrelated"],
    ] as const) {
      await writeFile(join(directory, `${title}.jsonl`), [
        JSON.stringify({ type: "session", version: 3, cwd: owner }),
        JSON.stringify({ type: "session_info", name: title }),
      ].join("\n"));
    }
    const scanFiles = vi.fn((): Promise<SessionFileScanResult> => Promise.resolve({ complete: false }));
    const sessions = await discoverPiSessions(
      [workingDirectory(cwd), { ...workingDirectory(linked), isCurrent: false }],
      [], "pi", resolveSessionRoots, scanFiles,
    );

    expect(scanFiles).toHaveBeenCalledExactlyOnceWith([linkedSessionDir, mainSessionDir]);
    expect(sessions.map((session) => session.title).sort()).toEqual(["Linked", "Main"]);
  });

  it("deduplicates shared custom directories and still filters sessions by cwd", async () => {
    const shared = join(agentDirectory, "shared");
    await mkdir(shared);
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", shared);
    for (const [owner, title] of [[cwd, "Main"], [join(cwd, "linked"), "Linked"], [join(cwd, "other"), "Other"]]) {
      await writeFile(join(shared, `${title}.jsonl`), [
        JSON.stringify({ type: "session", version: 3, cwd: owner }),
        JSON.stringify({ type: "session_info", name: title }),
      ].join("\n"));
    }
    const scanFiles = vi.fn((): Promise<SessionFileScanResult> => Promise.resolve({ complete: false }));
    const sessions = await discoverPiSessions(
      [workingDirectory(cwd), { ...workingDirectory(join(cwd, "linked")), isCurrent: false }],
      [], "pi", resolveSessionRoots, scanFiles,
    );

    expect(scanFiles).toHaveBeenCalledExactlyOnceWith([shared]);
    expect(sessions.map((session) => session.title).sort()).toEqual(["Linked", "Main"]);
  });

  it("does not fall back to global discovery when the configured directory is missing", async () => {
    const oldSessionDir = join(agentDirectory, "sessions", "old");
    await mkdir(oldSessionDir, { recursive: true });
    await writeFile(join(oldSessionDir, "old.jsonl"), JSON.stringify({ type: "session", version: 3, cwd }));
    const missing = join(cwd, "missing");
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "missing" }));
    const scanFiles = vi.fn((): Promise<SessionFileScanResult> => Promise.resolve({ complete: false }));

    expect(await discoverPiSessions([workingDirectory(cwd)], [], "pi", resolveSessionRoots, scanFiles)).toEqual([]);
    expect(scanFiles).toHaveBeenCalledExactlyOnceWith([missing]);
    await expect(access(missing)).rejects.toThrow();
  });

  it("uses the OMP root without reading Pi settings or Pi environment roots", async () => {
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "project-sessions" }));
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", join(cwd, "pi-env-sessions"));

    expect(await resolveSessionRoots(cwd, [], "oh-my-pi"))
      .toEqual([normalize(resolve(homedir(), ".omp", "agent", "sessions"))]);
    expect(await resolveSessionRoots(cwd, ["--session-dir", "chosen-sessions"], "oh-my-pi"))
      .toEqual([join(cwd, "chosen-sessions")]);
  });
});
