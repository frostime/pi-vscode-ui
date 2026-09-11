import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const TRUST_REQUIRING_PROJECT_ENTRIES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

export type PiSettings = Readonly<Record<string, unknown>>;

export type PiProjectTrustSource = "not-required" | "command-line" | "trust-store" | "default-policy";

export interface PiProjectTrust {
  trusted: boolean;
  source: PiProjectTrustSource;
}

export interface LoadedPiSettings {
  global: PiSettings;
  project: PiSettings;
  projectTrust: PiProjectTrust;
  merged: PiSettings;
}

export interface LoadPiSettingsOptions {
  piArguments?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
}

export function showCacheMissNoticesEnabled(settings: LoadedPiSettings): boolean {
  return settings.merged.showCacheMissNotices === true;
}

/** Load both Pi settings scopes and the effective merge used by a headless Pi process. */
export async function loadPiSettings(
  cwd: string,
  options: LoadPiSettingsOptions = {},
): Promise<LoadedPiSettings> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const resolvedCwd = resolve(cwd);
  const agentDirectory = resolvePiAgentDirectory(resolvedCwd, options.environment, homeDirectory);
  const globalPath = join(agentDirectory, "settings.json");
  const projectPath = join(resolvedCwd, ".pi", "settings.json");

  const [global, project, projectTrustRequired] = await Promise.all([
    readPiSettingsFile(globalPath),
    readPiSettingsFile(projectPath),
    hasTrustRequiringProjectResources(resolvedCwd, options.environment, homeDirectory),
  ]);
  const projectTrust = projectTrustRequired
    ? await resolveProjectTrust(resolvedCwd, agentDirectory, global, options.piArguments ?? [])
    : { trusted: true, source: "not-required" } as const;

  return {
    global,
    project,
    projectTrust,
    merged: projectTrust.trusted ? deepMerge(global, project) : global,
  };
}

export function resolvePiAgentDirectory(
  cwd: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = homedir(),
): string {
  const configured = environment.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homeDirectory, ".pi", "agent");

  const expanded = configured === "~"
    ? homeDirectory
    : configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(homeDirectory, configured.slice(2))
      : configured;
  const nativePath = normalizeWindowsShellPath(expanded);
  return isAbsolute(nativePath) ? resolve(nativePath) : resolve(cwd, nativePath);
}

async function hasTrustRequiringProjectResources(
  cwd: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = homedir(),
): Promise<boolean> {
  const configDirectory = join(cwd, ".pi");
  if ((await Promise.all(
    TRUST_REQUIRING_PROJECT_ENTRIES.map((entry) => fileExists(join(configDirectory, entry))),
  )).some(Boolean)) return true;

  const userAgentSkills = await canonicalPath(join(environment.HOME ?? homeDirectory, ".agents", "skills"));
  let directory = await canonicalPath(cwd);
  while (true) {
    const agentSkills = await canonicalPath(join(directory, ".agents", "skills"));
    if (agentSkills !== userAgentSkills && await fileExists(agentSkills)) return true;

    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

async function resolveProjectTrust(
  cwd: string,
  agentDirectory: string,
  globalSettings: PiSettings,
  piArguments: readonly string[],
): Promise<PiProjectTrust> {
  const commandLineTrust = projectTrustArgument(piArguments);
  if (commandLineTrust !== undefined) {
    return { trusted: commandLineTrust, source: "command-line" };
  }

  const storedTrust = await readNearestTrustDecision(join(agentDirectory, "trust.json"), cwd);
  if (storedTrust !== undefined) {
    return { trusted: storedTrust, source: "trust-store" };
  }

  return {
    trusted: globalSettings.defaultProjectTrust === "always",
    source: "default-policy",
  };
}

function projectTrustArgument(args: readonly string[]): boolean | undefined {
  let trusted: boolean | undefined;
  for (const argument of args) {
    if (argument === "--approve" || argument === "-a") trusted = true;
    if (argument === "--no-approve" || argument === "-na") trusted = false;
  }
  return trusted;
}

async function readNearestTrustDecision(path: string, cwd: string): Promise<boolean | undefined> {
  const trustStore = await readJsonObject(path);
  if (!trustStore) return undefined;

  let directory = await canonicalPath(cwd);
  while (true) {
    const decision = trustStore[directory];
    if (typeof decision === "boolean") return decision;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function readPiSettingsFile(path: string): Promise<PiSettings> {
  return await readJsonObject(path) ?? {};
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(path, "utf8");
    const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeWindowsShellPath(path: string): string {
  if (process.platform !== "win32" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return path;
  }
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  const suffix = match[2]?.replaceAll("/", "\\");
  return `${match[1]!.toUpperCase()}:\\${suffix ?? ""}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

function deepMerge(base: PiSettings, overrides: PiSettings): PiSettings {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, override] of Object.entries(overrides)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(override)
      ? deepMerge(current, override)
      : override;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
