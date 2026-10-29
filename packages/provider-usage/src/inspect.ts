/**
 * Opt-in development CLI for masked credential inspection.
 *
 * Invocation (never executed as a test, never in CI):
 *
 *   node packages/provider-usage/dist/inspect.js --agent-dir <agent-directory> [providerId ...]
 *
 * Environment: actual CLI runs use the process environment unmodified;
 * the `environment` parameter lets tests inject explicit synthetic maps so
 * no automated CLI invocation ever reads real process credentials.
 * The tool resolves references exactly like production resolution and masks
 * every value before printing. No network requests, no file writes, no OAuth
 * refresh. Failures print fixed safe messages, never raw errors (they may
 * embed paths or values). When no provider IDs are given, every supported
 * provider is inspected; providers with no configured credential source
 * appear as `not-configured` unavailable lines.
 */
import { pathToFileURL } from "node:url";

import { buildMaskedInspectionReport } from "./inspection.js";
import { PROVIDER_USAGE_DEFINITIONS } from "./providerDefinitions.js";

interface InspectArgs {
  agentDirectory: string | undefined;
  providerIds: string[];
}

/** Parses CLI arguments; throws a safe (content-free) error on misuse. */
export function parseInspectArgs(argv: readonly string[]): InspectArgs {
  let agentDirectory: string | undefined;
  const providerIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--agent-dir") {
      agentDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error("unknown tool option rejected");
    }
    providerIds.push(arg);
  }
  return { agentDirectory, providerIds };
}

const USAGE_LINES: readonly string[] = [
  "usage: inspect --agent-dir <directory> [provider ...]",
  "reads auth.json and models.json in the given agent directory; output is masked",
];

const UNSUPPORTED_PROVIDER_LINE =
  "unsupported provider ID requested; only supported provider IDs are inspected";
const UNKNOWN_FAILURE_LINE = "inspection failed; configuration could not be inspected safely";

/**
 * Runs the inspection with explicit output injection so tests can capture the
 * masked lines without spawning a process. `environment` injects an explicit
 * synthetic environment map for tests; when omitted (actual CLI use), the
 * process environment applies. Returns the process exit code.
 */
export async function runInspect(
  argv: readonly string[],
  write: (line: string) => void,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  let args: InspectArgs;
  try {
    args = parseInspectArgs(argv);
  } catch {
    // Safe failure output: no raw option values.
    write(UNKNOWN_FAILURE_LINE);
    write(USAGE_LINES[0] ?? "");
    return 2;
  }
  if (args.agentDirectory === undefined) {
    for (const line of USAGE_LINES) write(line);
    return 2;
  }
  const allowed = new Set(PROVIDER_USAGE_DEFINITIONS.map((definition) => definition.id));
  if (args.providerIds.some((id) => !allowed.has(id))) {
    write(UNSUPPORTED_PROVIDER_LINE);
    return 2;
  }
  const report = await buildMaskedInspectionReport(
    {
      agentDirectory: args.agentDirectory,
      includeAmbientEnvName: true,
      ...(environment ? { environment } : {}),
    },
    args.providerIds.length > 0 ? args.providerIds : undefined,
  );
  write(report);
  return 0;
}

async function main(): Promise<number> {
  // Actual CLI use: process environment, unmodified.
  return runInspect(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}

/**
 * Only the directly executed entrypoint runs `main`: importing inspection
 * helpers from another module never runs the CLI.
 */
const invokedDirectly = process.argv[1] !== undefined && invocationMatchesThisModule(process.argv[1]);

function invocationMatchesThisModule(argvValue: string): boolean {
  try {
    return import.meta.url === pathToFileURL(argvValue).href;
  } catch {
    return false;
  }
}
if (invokedDirectly) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch(() => {
      // Never surface raw errors: they may embed paths or values.
      process.stdout.write(`${UNKNOWN_FAILURE_LINE}\n`);
      process.exitCode = 1;
    });
}
