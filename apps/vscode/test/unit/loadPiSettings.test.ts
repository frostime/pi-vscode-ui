import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadPiSettings,
  resolvePiAgentDirectory,
  showCacheMissNoticesEnabled,
} from "../../src/extension/_shared/pi-settings/loadPiSettings.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Pi settings loading", () => {
  it("returns both scopes, project trust, and Pi's deep-merged effective settings", async () => {
    const { cwd, agentDirectory } = await createLayout();
    await writeJson(join(agentDirectory, "settings.json"), {
      defaultProjectTrust: "always",
      showCacheMissNotices: false,
      retry: { enabled: true, maxRetries: 3 },
    });
    await writeJson(join(cwd, ".pi", "settings.json"), {
      showCacheMissNotices: true,
      retry: { maxRetries: 1 },
    });

    const settings = await loadPiSettings(cwd, { environment: agentEnvironment(agentDirectory) });

    expect(settings.global.showCacheMissNotices).toBe(false);
    expect(settings.project.showCacheMissNotices).toBe(true);
    expect(settings.projectTrust).toEqual({ trusted: true, source: "default-policy" });
    expect(settings.merged).toMatchObject({
      showCacheMissNotices: true,
      retry: { enabled: true, maxRetries: 1 },
    });
    expect(showCacheMissNoticesEnabled(settings)).toBe(true);
  });

  it("keeps project settings inspectable but excludes them when headless Pi would not trust the project", async () => {
    const { cwd, agentDirectory } = await createLayout();
    await writeJson(join(agentDirectory, "settings.json"), { showCacheMissNotices: false });
    await writeJson(join(cwd, ".pi", "settings.json"), { showCacheMissNotices: true });

    const settings = await loadPiSettings(cwd, { environment: agentEnvironment(agentDirectory) });

    expect(settings.project).toEqual({ showCacheMissNotices: true });
    expect(settings.projectTrust).toEqual({ trusted: false, source: "default-policy" });
    expect(settings.merged).toEqual(settings.global);
    expect(showCacheMissNoticesEnabled(settings)).toBe(false);
  });

  it("uses the last command-line trust override", async () => {
    const { cwd, agentDirectory } = await createLayout();
    await writeJson(join(cwd, ".pi", "settings.json"), { showCacheMissNotices: true });

    const approved = await loadPiSettings(cwd, {
      environment: agentEnvironment(agentDirectory),
      piArguments: ["--no-approve", "--approve"],
    });
    const rejected = await loadPiSettings(cwd, {
      environment: agentEnvironment(agentDirectory),
      piArguments: ["-a", "-na"],
    });

    expect(approved.projectTrust).toEqual({ trusted: true, source: "command-line" });
    expect(showCacheMissNoticesEnabled(approved)).toBe(true);
    expect(rejected.projectTrust).toEqual({ trusted: false, source: "command-line" });
    expect(showCacheMissNoticesEnabled(rejected)).toBe(false);
  });

  it("uses the nearest saved trust decision, including a trusted parent", async () => {
    const { root, cwd, agentDirectory } = await createLayout("workspace/project");
    await writeJson(join(cwd, ".pi", "settings.json"), { showCacheMissNotices: true });
    const trustedParent = await realpath(join(root, "workspace"));
    await writeJson(join(agentDirectory, "trust.json"), { [trustedParent]: true });

    const settings = await loadPiSettings(cwd, { environment: agentEnvironment(agentDirectory) });

    expect(settings.projectTrust).toEqual({ trusted: true, source: "trust-store" });
    expect(showCacheMissNoticesEnabled(settings)).toBe(true);
  });

  it("reports trust required by other Pi project resources even without project settings", async () => {
    const { cwd, agentDirectory } = await createLayout();
    await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });

    const settings = await loadPiSettings(cwd, { environment: agentEnvironment(agentDirectory) });

    expect(settings.projectTrust).toEqual({ trusted: false, source: "default-policy" });
    expect(settings.project).toEqual({});
    expect(settings.merged).toEqual(settings.global);
  });

  it("honors a relative PI_CODING_AGENT_DIR and treats absent or malformed settings as empty", async () => {
    const { cwd } = await createLayout();
    const environment = { PI_CODING_AGENT_DIR: ".config/pi" };
    await mkdir(join(cwd, ".config", "pi"), { recursive: true });
    await writeFile(join(cwd, ".config", "pi", "settings.json"), "not json");

    const settings = await loadPiSettings(cwd, { environment });

    expect(resolvePiAgentDirectory(cwd, environment)).toBe(join(cwd, ".config", "pi"));
    if (process.platform === "win32") {
      expect(resolvePiAgentDirectory(cwd, { PI_CODING_AGENT_DIR: "/c/Users/example/.pi/agent" }))
        .toBe("C:\\Users\\example\\.pi\\agent");
    }
    expect(settings).toEqual({
      global: {},
      project: {},
      projectTrust: { trusted: true, source: "not-required" },
      merged: {},
    });
    expect(showCacheMissNoticesEnabled(settings)).toBe(false);
  });

  it("requires the effective cache-notice setting to be a boolean true", async () => {
    const { cwd, agentDirectory } = await createLayout();
    await writeJson(join(agentDirectory, "settings.json"), { showCacheMissNotices: "true" });

    const settings = await loadPiSettings(cwd, { environment: agentEnvironment(agentDirectory) });

    expect(showCacheMissNoticesEnabled(settings)).toBe(false);
  });
});

async function createLayout(relativeCwd = "workspace"): Promise<{
  root: string;
  cwd: string;
  agentDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "frostpi-settings-"));
  temporaryDirectories.push(root);
  const cwd = join(root, relativeCwd);
  const agentDirectory = join(root, "agent");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(agentDirectory, { recursive: true }),
  ]);
  return { root, cwd, agentDirectory };
}

function agentEnvironment(agentDirectory: string): Record<string, string> {
  return { PI_CODING_AGENT_DIR: agentDirectory };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
