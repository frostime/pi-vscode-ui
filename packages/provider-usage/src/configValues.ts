/**
 * Configuration value parsing and resolution, ported from Pi 1.1.0
 * (`dist/core/resolve-config-value.js`) with one deliberate difference:
 *
 * Leading `!` shell-command values are classified as unsupported references.
 * They are never executed, and resolution does not fall through to another
 * source when a selected credential is a command value.
 *
 * Supported value kinds (Pi-compatible):
 * - literal text;
 * - `$NAME` and `${NAME}` environment references;
 * - `$$` and `$!` escape literals inside templates;
 * - `${NAME}` fragments with invalid environment names stay literal text.
 */

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ENV_VAR_NAME_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/u;

export type ConfigValuePart =
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string };

export type ConfigValueReference =
  | { kind: "template"; parts: readonly ConfigValuePart[] }
  | { kind: "command" };

export function parseConfigValue(config: string): ConfigValueReference {
  if (config.startsWith("!")) return { kind: "command" };
  return { kind: "template", parts: parseTemplate(config) };
}

function parseTemplate(config: string): ConfigValuePart[] {
  const parts: ConfigValuePart[] = [];
  const appendLiteral = (value: string): void => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === "literal") previous.value += value;
    else parts.push({ kind: "literal", value });
  };

  let index = 0;
  while (index < config.length) {
    const dollarIndex = config.indexOf("$", index);
    if (dollarIndex < 0) {
      appendLiteral(config.slice(index));
      break;
    }
    appendLiteral(config.slice(index, dollarIndex));
    const next = config[dollarIndex + 1];
    if (next === "$" || next === "!") {
      appendLiteral(next);
      index = dollarIndex + 2;
      continue;
    }
    if (next === "{") {
      const endIndex = config.indexOf("}", dollarIndex + 2);
      if (endIndex < 0) {
        appendLiteral("$");
        index = dollarIndex + 1;
        continue;
      }
      const name = config.slice(dollarIndex + 2, endIndex);
      if (ENV_VAR_NAME_PATTERN.test(name)) {
        parts.push({ kind: "env", name });
      } else {
        // Pi keeps non-variable `${...}` text literal.
        appendLiteral(config.slice(dollarIndex, endIndex + 1));
      }
      index = endIndex + 1;
      continue;
    }
    const prefixMatch = ENV_VAR_NAME_PREFIX_PATTERN.exec(config.slice(dollarIndex + 1));
    if (prefixMatch) {
      const [name] = prefixMatch;
      parts.push({ kind: "env", name });
      index = dollarIndex + 1 + name.length;
      continue;
    }
    appendLiteral("$");
    index = dollarIndex + 1;
  }
  return parts;
}

export function referenceEnvVarNames(reference: ConfigValueReference): string[] {
  if (reference.kind !== "template") return [];
  const names: string[] = [];
  for (const part of reference.parts) {
    if (part.kind === "env" && !names.includes(part.name)) names.push(part.name);
  }
  return names;
}

/** Environment setter chain: credential-local values, then the resolution environment. */
export type EnvironmentLookup = (name: string) => string | undefined;

/**
 * Resolves an integer template against an environment lookup chain.
 * Returns undefined when any referenced variable is missing (Pi semantics,
 * unlike `${name:-default}` style tools). Command references resolve to undefined.
 */
export function resolveConfigValue(config: string, lookupEnvironment: EnvironmentLookup): string | undefined {
  const reference = parseConfigValue(config);
  if (reference.kind === "command") {
    return undefined;
  }
  let resolved = "";
  for (const part of reference.parts) {
    if (part.kind === "literal") {
      resolved += part.value;
      continue;
    }
    const value = lookupEnvironment(part.name);
    if (value === undefined) return undefined;
    resolved += value;
  }
  return resolved;
}
