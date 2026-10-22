import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopStateStore, DesktopStateWriteError } from "../src/main/storage/DesktopStateStore.js";
import * as jsonFile from "../src/main/storage/jsonFile.js";

let root: string;
let file: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "frostpi-state-test-"));
  file = join(root, "state.json");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const emptyState = () => ({ version: 1, projects: [], activeProjectId: null, workspaceState: {} });
const projectView = (cwd: string) => ({ projects: [{ id: "stable-id", name: "Project", cwd }], activeProjectId: "stable-id" });

describe("DesktopStateStore", () => {
  it("opens and flushes a missing file without creating it", async () => {
    const store = await DesktopStateStore.open(file);
    expect(store.filePath).toBe(file);
    expect(store.projects).toEqual({ projects: [], activeProjectId: null });
    expect(store.error).toBeUndefined();
    expect(store.get("toString")).toBeUndefined();
    await store.flush();
    expect(await readdir(root)).toEqual([]);
  });

  it("merges interleaved project and raw Memento updates with immediate reads and durable snapshots", async () => {
    const store = await DesktopStateStore.open(file);
    const projects = projectView(root);
    const metadata = { selectedPi: "pi-identity", sessions: [{ id: "pi-identity", cwd: root }] };
    const projectSave = store.saveProjects({ ...projects, error: "transient" } as typeof projects);
    const metadataSave = store.update("arbitrary.memento.key", metadata);
    expect(store.projects).toEqual(projects);
    expect(store.get("arbitrary.memento.key")).toEqual(metadata);
    const otherSave = store.update("toString", { own: true });
    await Promise.all([projectSave, metadataSave, otherSave]);
    const reopened = await DesktopStateStore.open(file);
    expect(reopened.projects).toEqual(projects);
    expect(reopened.get("arbitrary.memento.key")).toEqual(metadata);
    expect(reopened.get("toString")).toEqual({ own: true });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1, ...projects,
      workspaceState: { "arbitrary.memento.key": metadata, toString: { own: true } },
    });
  });

  it("isolates caller mutations and deletes keys without exposing inherited keys", async () => {
    const store = await DesktopStateStore.open(file);
    const projects = projectView(root);
    const value = { nested: ["original"] };
    const saves = [store.saveProjects(projects), store.update("metadata", value)];
    projects.projects[0]!.name = "changed input";
    value.nested.push("changed input");
    store.projects.projects[0]!.name = "changed output";
    store.get<typeof value>("metadata")!.nested.push("changed output");
    expect(store.projects).toEqual(projectView(root));
    expect(store.get("metadata")).toEqual({ nested: ["original"] });
    await Promise.all(saves);
    const deletion = store.update("metadata", undefined);
    expect(store.get("metadata")).toBeUndefined();
    await deletion;
    expect((await DesktopStateStore.open(file)).get("metadata")).toBeUndefined();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, ...projectView(root), workspaceState: {} });
  });

  it.each([
    "{ invalid secret-token",
    JSON.stringify({ ...emptyState(), version: 2 }),
    JSON.stringify({ projects: [], activeProjectId: null, workspaceState: {} }),
    JSON.stringify({ ...emptyState(), settings: { secret: "secret-token" } }),
    JSON.stringify({ ...emptyState(), activeProjectId: "missing" }),
    JSON.stringify({ ...emptyState(), projects: [{ id: "id", name: "", cwd: "/absolute" }] }),
    JSON.stringify({ ...emptyState(), projects: [{ id: "id", name: "name", cwd: "relative" }] }),
    JSON.stringify({ ...emptyState(), projects: Array(2).fill({ id: "id", name: "name", cwd: "/absolute" }) }),
    JSON.stringify({ ...emptyState(), workspaceState: [] }),
    '{"version":1,"projects":[],"activeProjectId":null,"workspaceState":{"__proto__":{"secret":"secret-token"}}}',
    " ".repeat(jsonFile.MAX_JSON_BYTES + 1),
  ])("protects invalid files for manual repair without leaking their contents (%#)", async (text) => {
    await writeFile(file, text);
    const store = await DesktopStateStore.open(file);
    expect(store.projects).toEqual({ projects: [], activeProjectId: null });
    expect(store.error).toContain("restart");
    expect(store.error).not.toContain("secret-token");
    await expect(store.update("secret-token", "secret-token")).rejects.toThrow("restart");
    await expect(store.saveProjects(projectView(root))).rejects.toThrow("restart");
    await expect(store.flush()).rejects.toThrow("restart");
    expect(store.get("secret-token")).toBeUndefined();
    expect(await readFile(file, "utf8")).toBe(text);
    // Even an external repair cannot unlock this instance and overwrite newer disk data.
    await writeFile(file, JSON.stringify(emptyState()));
    await expect(store.update("key", "value")).rejects.toThrow("restart");
    expect((await DesktopStateStore.open(file)).error).toBeUndefined();
  });

  it("treats a file ancestor as a read failure, not a missing state file", async () => {
    await writeFile(file, "not a directory");
    const store = await DesktopStateStore.open(join(file, "state.json"));
    expect(store.error).toContain("Cannot read");
    await expect(store.flush()).rejects.toThrow("Cannot read");
    expect(await readFile(file, "utf8")).toBe("not a directory");
  });

  it("rejects invalid and oversized mutations before changing desired metadata", async () => {
    const store = await DesktopStateStore.open(file);
    await store.saveProjects(projectView(root));
    await expect(store.saveProjects({ projects: [], activeProjectId: "missing" })).rejects.toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const rejectedMetadata = store.update("secret-token", cyclic);
    await expect(rejectedMetadata).rejects.not.toThrow("secret-token");
    await expect(rejectedMetadata).rejects.not.toBeInstanceOf(DesktopStateWriteError);
    await expect(store.update("large", "x".repeat(jsonFile.MAX_JSON_BYTES))).rejects.toThrow("1 MiB");
    expect(store.projects).toEqual(projectView(root));
    expect(store.get("secret-token")).toBeUndefined();
    expect(store.get("large")).toBeUndefined();
    await expect(store.update("__proto__", { unsupported: true })).rejects.toThrow();
    expect(store.get("__proto__")).toBeUndefined();
    expect(store.error).toBeUndefined();
    expect((await DesktopStateStore.open(file)).projects).toEqual(projectView(root));
  });

  it("retains failed desired project and Memento updates, rejects failed flush, and recovers after repair", async () => {
    const folder = join(root, "folder");
    const target = join(folder, "state.json");
    const store = await DesktopStateStore.open(target);
    await store.update("old", true);
    await rename(folder, join(root, "backup"));
    await writeFile(folder, "not a directory");
    const errors: Array<string | undefined> = [];
    const stop = store.onDidChange(() => { errors.push(store.error); });
    store.onDidChange(() => { throw new Error("observer secret-token"); });
    const acceptedWrite = store.saveProjects(projectView(root));
    await expect(acceptedWrite).rejects.toThrow("Cannot save");
    await expect(acceptedWrite).rejects.toBeInstanceOf(DesktopStateWriteError);
    await expect(store.update("selected", "pi-identity")).rejects.toThrow("Cannot save");
    expect(store.projects).toEqual(projectView(root));
    expect(store.get("selected")).toBe("pi-identity");
    await expect(store.flush()).rejects.toThrow("Cannot save");
    expect(errors).toEqual([store.error]);
    await rm(folder);
    await rename(join(root, "backup"), folder);
    await store.flush();
    expect(errors).toEqual([expect.stringContaining("Cannot save"), undefined]);
    expect(store.error).toBeUndefined();
    const reopened = await DesktopStateStore.open(target);
    expect(reopened.projects).toEqual(projectView(root));
    expect(reopened.get("selected")).toBe("pi-identity");
    expect(reopened.get("old")).toBe(true);
    expect(await readdir(folder)).toEqual(["state.json"]);
    stop();
  });

  it("lets a later normal write recover while preserving an earlier failed project update", async () => {
    const store = await DesktopStateStore.open(file);
    vi.spyOn(jsonFile, "writeFileAtomically").mockRejectedValueOnce(new Error("secret-token"));
    await expect(store.saveProjects(projectView(root))).rejects.not.toThrow("secret-token");
    await store.update("selected", "pi-identity");
    expect(store.error).toBeUndefined();
    const reopened = await DesktopStateStore.open(file);
    expect(reopened.projects).toEqual(projectView(root));
    expect(reopened.get("selected")).toBe("pi-identity");
  });

  it("flush waits for all queued atomic writes before returning", async () => {
    const store = await DesktopStateStore.open(file);
    const write = jsonFile.writeFileAtomically;
    let notifyEntered!: () => void;
    let releaseWrite!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const released = new Promise<void>((resolve) => { releaseWrite = resolve; });
    vi.spyOn(jsonFile, "writeFileAtomically").mockImplementationOnce(async (path, text) => {
      notifyEntered();
      await released;
      await write(path, text);
    });
    const first = store.saveProjects(projectView(root));
    const second = store.update("selected", "pi-identity");
    let drained = false;
    const flush = store.flush().then(() => { drained = true; });
    await entered;
    try {
      expect(drained).toBe(false);
      expect(await readdir(root)).toEqual([]);
    } finally {
      releaseWrite();
    }
    await Promise.all([first, second, flush]);
    expect(drained).toBe(true);
    const reopened = await DesktopStateStore.open(file);
    expect(reopened.projects).toEqual(projectView(root));
    expect(reopened.get("selected")).toBe("pi-identity");
  });
});
