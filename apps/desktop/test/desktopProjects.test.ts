import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { describe, expect, it } from "vitest";

import { DesktopProjects } from "../src/main/desktopProjects.js";

describe("DesktopProjects", () => {
  it("validates and canonicalizes a real directory, deduping alias spellings", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");

    const projects = new DesktopProjects();
    const added = await projects.addProject(target);

    expect(added).toMatchObject({ name: "target", cwd: target });
    expect(projects.list()).toHaveLength(1);

    const notifications: Array<string | null> = [];
    projects.onDidChange(() => notifications.push(projects.selected?.id ?? null));

    // The alias spelling resolves to the same canonical directory: one Project, stable id.
    const again = await projects.addProject(alias);
    expect(again.id).toBe(added.id);
    expect(projects.list()).toHaveLength(1);
    expect(projects.selected?.id).toBe(added.id);
    expect(notifications).toEqual([]);

    projects.selectProject(null);
    expect(notifications).toEqual([null]);
    await projects.addProject(alias);
    expect(notifications).toEqual([null, added.id]);
    expect(projects.selected?.id).toBe(added.id);
    await projects.addProject(target);
    expect(notifications).toEqual([null, added.id]);
  });

  it("restores stable identities, names and selection, publishing the complete view once", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");

    const projects = new DesktopProjects();
    await projects.addProject(parent);
    const saved = [
      { id: "saved-target", name: "Custom target name", cwd: alias },
      { id: "saved-parent", name: "Custom parent name", cwd: parent },
    ];
    const expected = [{ ...saved[0], cwd: target }, saved[1]];
    const notifications: unknown[] = [];
    projects.onDidChange(() => notifications.push({ projects: projects.list(), selected: projects.selected }));

    await projects.restore({ projects: saved, activeProjectId: "saved-parent" });

    expect(projects.list()).toEqual(expected);
    expect(projects.selected).toEqual(saved[1]);
    expect(notifications).toEqual([{ projects: expected, selected: saved[1] }]);
  });

  it("maps a selected duplicate alias to the first canonical Project identity", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const retained = { id: "original", name: "Original name", cwd: target };
    const projects = new DesktopProjects();

    await projects.restore({
      projects: [retained, { id: "alias-id", name: "Alias name", cwd: alias }],
      activeProjectId: "alias-id",
    });

    expect(projects.list()).toEqual([retained]);
    expect(projects.selected).toEqual(retained);
  });

  it.each([null, "unknown"])("does not infer an anchor for restored selection %s", async (activeProjectId) => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-")));
    const projects = new DesktopProjects();
    await projects.addProject(cwd);
    const saved = { id: "saved", name: "Saved", cwd };

    await projects.restore({ projects: [saved], activeProjectId });

    expect(projects.list()).toEqual([saved]);
    expect(projects.selected).toBeNull();
  });

  it("retains a missing restored directory while ordinary add still rejects it", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-")));
    const missing = join(parent, "moved-away");
    const saved = { id: "missing", name: "Keep this name", cwd: missing };
    const projects = new DesktopProjects();

    await projects.restore({ projects: [{ ...saved, cwd: join(missing, "..", "moved-away") }], activeProjectId: saved.id });

    expect(projects.list()).toEqual([saved]);
    expect(projects.selected).toEqual(saved);
    await expect(projects.addProject(missing)).rejects.toThrow("not an existing directory");
    expect(projects.list()).toEqual([saved]);
    expect(projects.selected).toEqual(saved);
  });

  it("keeps a non-empty display name for a volume-root Project", async () => {
    const projects = new DesktopProjects();
    const root = parse(tmpdir()).root;
    const project = await projects.addProject(root);
    expect(project.name).toBe(project.cwd);
  });

  it("rejects missing directories, files, and blank input explicitly", async () => {
    const parent = await mkdtemp(join(tmpdir(), "frostpi-projects-"));
    const file = join(parent, "notes.txt");
    await writeFile(file, "x");

    const projects = new DesktopProjects();
    await expect(projects.addProject(join(parent, "missing"))).rejects.toThrow("not an existing directory");
    await expect(projects.addProject(file)).rejects.toThrow("not an existing directory");
    await expect(projects.addProject("")).rejects.toThrow("Choose a directory");
    expect(projects.list()).toEqual([]);
    expect(projects.selected).toBeNull();
  });

  it("keeps an explicit anchor: switching selection never removes roots, unknown ids fail", async () => {
    // Project roots are canonicalized on add, so expectations must use the real path
    // (a Windows temp directory can be reached through its 8.3 short name).
    const a = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-a-")));
    const b = await realpath(await mkdtemp(join(tmpdir(), "frostpi-projects-b-")));

    const projects = new DesktopProjects();
    const projectA = await projects.addProject(a);
    const projectB = await projects.addProject(b);

    projects.selectProject(projectB.id);
    expect(projects.selected?.cwd).toBe(b);

    projects.selectProject(null);
    expect(projects.selected).toBeNull();
    // Roots are stable regardless of the anchor state.
    expect(projects.list().map((project) => project.cwd)).toEqual([a, b]);

    projects.selectProject(projectA.id);
    expect(projects.selected?.cwd).toBe(a);
    expect(projects.list()).toHaveLength(2);

    expect(() => projects.selectProject("unknown")).toThrow("Unknown FrostPi Project");
  });
});
