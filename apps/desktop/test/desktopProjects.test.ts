import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

    // The alias spelling resolves to the same canonical directory: one Project, stable id.
    const again = await projects.addProject(alias);
    expect(again.id).toBe(added.id);
    expect(projects.list()).toHaveLength(1);
    expect(projects.selected?.id).toBe(added.id);
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
    const a = await mkdtemp(join(tmpdir(), "frostpi-projects-a-"));
    const b = await mkdtemp(join(tmpdir(), "frostpi-projects-b-"));

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
