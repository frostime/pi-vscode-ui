import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { minimatch } from "minimatch";

import type { RpcModel } from "@frostime/pi-rpc";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const DATED_MODEL_ID = /-\d{8}$/;

type PiSettings = Record<string, unknown>;

/**
 * Resolve the model patterns used by Pi's --models/enabledModels scope.
 * Returns canonical provider/model ids so the Webview can index the full catalogue.
 */
export function resolveModelScopePatterns(
  patterns: readonly string[] | undefined,
  models: readonly RpcModel[],
): string[] {
  if (!patterns?.length) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;

    for (const model of resolvePattern(pattern, models)) {
      const id = modelKey(model);
      if (seen.has(id)) continue;
      seen.add(id);
      resolved.push(id);
    }
  }
  return resolved;
}

/**
 * Select patterns with the same precedence Pi uses: --models, project settings,
 * then global settings. A present project enabledModels value, including an
 * empty or invalid value, overrides the global value.
 */
export function selectModelPatterns(
  piArguments: readonly string[],
  globalSettings: unknown,
  projectSettings: unknown,
): string[] | undefined {
  const cliPatterns = modelsArgument(piArguments);
  if (cliPatterns !== undefined) return cliPatterns;

  const projectPatterns = enabledModels(projectSettings);
  if (projectPatterns !== undefined) return projectPatterns;
  return enabledModels(globalSettings);
}

/** Resolve the effective configured scope without making Pi RPC changes. */
export async function resolvePiModelScope(
  cwd: string,
  piArguments: readonly string[],
  models: readonly RpcModel[],
): Promise<string[]> {
  // This is a display-only mirror; project trust is intentionally not reproduced here.
  const [globalSettings, projectSettings] = await Promise.all([
    readSettings(join(piAgentDir(cwd), "settings.json")),
    readSettings(join(cwd, ".pi", "settings.json")),
  ]);
  return resolveModelScopePatterns(selectModelPatterns(piArguments, globalSettings, projectSettings), models);
}

function resolvePattern(pattern: string, models: readonly RpcModel[]): RpcModel[] {
  if (hasGlob(pattern)) {
    const modelPattern = stripThinkingLevel(pattern);
    const exact = findExactModel(modelPattern, models);
    if (exact) return [exact];

    try {
      return models.filter((model) => (
        minimatch(modelKey(model), modelPattern, { nocase: true }) ||
        minimatch(model.id, modelPattern, { nocase: true })
      ));
    } catch {
      return [];
    }
  }

  const direct = findBestModel(pattern, models);
  if (direct) return [direct];

  const separator = pattern.lastIndexOf(":");
  if (separator < 0 || !THINKING_LEVELS.has(pattern.slice(separator + 1))) return [];
  const prefixedModel = findBestModel(pattern.slice(0, separator), models);
  return prefixedModel ? [prefixedModel] : [];
}

function findBestModel(pattern: string, models: readonly RpcModel[]): RpcModel | undefined {
  const exact = findExactModel(pattern, models);
  if (exact) return exact;

  const normalized = pattern.toLowerCase();
  const matches = models.filter((model) => (
    model.id.toLowerCase().includes(normalized) ||
    model.name?.toLowerCase().includes(normalized) === true
  ));
  if (!matches.length) return undefined;

  const aliases = matches.filter((model) => !DATED_MODEL_ID.test(model.id));
  const candidates = aliases.length ? aliases : matches;
  return [...candidates].sort((a, b) => b.id.localeCompare(a.id))[0];
}

function findExactModel(pattern: string, models: readonly RpcModel[]): RpcModel | undefined {
  const normalized = pattern.toLowerCase();
  const canonicalMatches = models.filter((model) => modelKey(model).toLowerCase() === normalized);
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;

  const idMatches = models.filter((model) => model.id.toLowerCase() === normalized);
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

function stripThinkingLevel(pattern: string): string {
  const separator = pattern.lastIndexOf(":");
  if (separator < 0 || !THINKING_LEVELS.has(pattern.slice(separator + 1))) return pattern;
  return pattern.slice(0, separator);
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

function modelKey(model: RpcModel): string {
  return `${model.provider}/${model.id}`;
}

function piAgentDir(cwd: string): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  const expanded = configured.startsWith("~/") || configured.startsWith("~\\")
    ? join(homedir(), configured.slice(2))
    : configured;
  return isAbsolute(expanded) ? expanded : join(cwd, expanded);
}

function modelsArgument(args: readonly string[]): string[] | undefined {
  let patterns: string[] | undefined;
  for (let index = 0; index + 1 < args.length; index += 1) {
    if (args[index] !== "--models") continue;
    patterns = args[index + 1]!.split(",").map((pattern) => pattern.trim()).filter(Boolean);
    index += 1;
  }
  return patterns;
}

function enabledModels(value: unknown): string[] | undefined {
  if (!isSettings(value) || !("enabledModels" in value)) return undefined;
  if (!Array.isArray(value.enabledModels) || !value.enabledModels.every((pattern) => typeof pattern === "string")) return [];
  return value.enabledModels;
}

async function readSettings(path: string): Promise<PiSettings | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isSettings(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSettings(value: unknown): value is PiSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
