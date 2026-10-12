/**
 * Reads and validates a Pi configuration snapshot: auth.json stored
 * credentials and provider-level models.json records.
 *
 * Validation mirrors Pi 1.1.0 (`dist/core/auth-storage.js` ReadOnlyAuthStorage
 * and `dist/core/model-config.js` ModelConfig):
 * - auth.json is plain JSON without comments; one invalid entry invalidates
 *   the whole file (no partial stored credentials);
 * - models.json tolerates `//` comments and trailing commas; a schema
 *   violation invalidates the whole file;
 * - per-model `models` and `modelOverrides` authentication is intentionally
 *   out of Phase 1 scope and ignored here;
 * - missing files are absent configuration; parse or read failures become
 *   explicit file state, never content-bearing errors.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type EnvironmentLookup } from "./configValues.js";
import { type ProviderResolutionInput } from "./types.js";

export type FileState = "ok" | "malformed" | "unreadable" | "absent";

export type StoredApiKeyCredential = {
  kind: "api-key";
  /** Raw configuration value; may reference `$ENV` or be a `!command`. */
  rawKey: string | undefined;
  /** Credential-local environment values used by `$ENV` references. */
  env: Readonly<Record<string, string | undefined>>;
};

export type StoredOAuthCredential = {
  kind: "oauth";
  access: string;
  refresh: string;
  /** Expiry epoch milliseconds; validated finite. */
  expires: number;
  /** Extra provider-specific fields (e.g. enterpriseUrl, scopes, clientId). */
  fields: Readonly<Record<string, unknown>>;
};

export type StoredCredential = StoredApiKeyCredential | StoredOAuthCredential;

export interface ModelsProviderConfig {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  headers: Readonly<Record<string, string>> | undefined;
  authHeader: boolean;
}

export interface ConfigurationSnapshot {
  authFileState: FileState;
  storedCredentials: ReadonlyMap<string, StoredCredential>;
  modelsFileState: FileState;
  modelsProviders: ReadonlyMap<string, ModelsProviderConfig>;
  /** Ambient environment lookup: the supplied environment when provided, otherwise process.env. */
  environment: EnvironmentLookup;
}

const AUTH_JSON_NAME = "auth.json";
const MODELS_JSON_NAME = "models.json";

export async function loadConfigurationSnapshot(input: ProviderResolutionInput): Promise<ConfigurationSnapshot> {
  const authPath = input.authPath ?? (input.agentDirectory ? join(input.agentDirectory, AUTH_JSON_NAME) : undefined);
  const modelsJsonPath =
    input.modelsJsonPath ?? (input.agentDirectory ? join(input.agentDirectory, MODELS_JSON_NAME) : undefined);
  const environment = resolveAmbientEnvironment(input.environment);
  const [auth, models] = await Promise.all([
    authPath === undefined ? absentAuth() : readAuthJson(authPath),
    modelsJsonPath === undefined ? absentModels() : readModelsJson(modelsJsonPath),
  ]);
  return {
    authFileState: auth.state,
    storedCredentials: auth.credentials,
    modelsFileState: models.state,
    modelsProviders: models.providers,
    environment,
  };
}

function resolveAmbientEnvironment(
  supplied: Readonly<Record<string, string | undefined>> | undefined,
): EnvironmentLookup {
  if (supplied !== undefined) {
    // A supplied environment replaces process.env entirely: tests stay
    // isolated from developer/machine credentials and the Host supplies its
    // own environment explicitly.
    return (name) => supplied[name];
  }
  return (name) => process.env[name];
}

interface AuthSnapshot {
  state: FileState;
  credentials: Map<string, StoredCredential>;
}

function absentAuth(): AuthSnapshot {
  return { state: "absent", credentials: new Map() };
}

async function readAuthJson(authPath: string): Promise<AuthSnapshot> {
  let content: string;
  try {
    content = await readFile(authPath, "utf-8");
  } catch (error) {
    if (isMissingEntry(error)) return { state: "absent", credentials: new Map() };
    return { state: "unreadable", credentials: new Map() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch {
    // The parse exception may quote file content; only a fixed safe reason is kept.
    return { state: "malformed", credentials: new Map() };
  }
  const credentials = validateAuthJson(parsed);
  if (!credentials) {
    return { state: "malformed", credentials: new Map() };
  }
  return { state: "ok", credentials };
}

/**
 * Exactly-mirrors Pi's per-entry validation: `api_key` entries need a string
 * or absent `key` and a string-valued `env` record; `oauth` entries need
 * string `access`/`refresh` and a finite `expires`. Unknown additional fields
 * are preserved inside `fields` for provider-specific interpretation.
 */
function validateAuthJson(parsed: unknown): Map<string, StoredCredential> | undefined {
  if (!isRecord(parsed) || Array.isArray(parsed)) return undefined;
  const credentials = new Map<string, StoredCredential>();
  for (const [providerId, value] of Object.entries(parsed)) {
    if (!isRecord(value)) return undefined;
    if (value.type === "api_key") {
      const key = value.key;
      const env = value.env;
      if (key !== undefined && typeof key !== "string") return undefined;
      if (env !== undefined && !isStringRecord(env)) return undefined;
      credentials.set(providerId, { kind: "api-key", rawKey: key, env: env ?? {} });
    } else if (value.type === "oauth") {
      const { access, refresh, expires, ...fields } = value;
      if (typeof access !== "string" || typeof refresh !== "string") return undefined;
      if (typeof expires !== "number" || !Number.isFinite(expires)) return undefined;
      credentials.set(providerId, { kind: "oauth", access, refresh, expires, fields });
    } else {
      // Pi accepts only these two credential types.
      return undefined;
    }
  }
  return credentials;
}

interface ModelsSnapshot {
  state: FileState;
  providers: Map<string, ModelsProviderConfig>;
}

function absentModels(): ModelsSnapshot {
  return { state: "absent", providers: new Map() };
}

async function readModelsJson(modelsJsonPath: string): Promise<ModelsSnapshot> {
  let content: string;
  try {
    content = await readFile(modelsJsonPath, "utf-8");
  } catch (error) {
    if (isMissingEntry(error)) return { state: "absent", providers: new Map() };
    return { state: "unreadable", providers: new Map() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(stripBom(content)));
  } catch {
    return { state: "malformed", providers: new Map() };
  }
  const providers = validateModelsJson(parsed);
  if (!providers) {
    return { state: "malformed", providers: new Map() };
  }
  return { state: "ok", providers };
}

/** Pi semantics: ENOENT is absent configuration, not a broken file. */
function isMissingEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Validates the provider-level fields used by this package; per-model entries
 * and other Pi schema fields (compat, api, oauth, models, modelOverrides) are
 * out of scope here and ignored. `apiKey`, `baseUrl` and header values are
 * raw configuration values resolved later.
 */
function validateModelsJson(parsed: unknown): Map<string, ModelsProviderConfig> | undefined {
  if (!isRecord(parsed) || Array.isArray(parsed)) return undefined;
  const providersRoot = parsed.providers;
  if (!isRecord(providersRoot) || Array.isArray(providersRoot)) return undefined;
  const providers = new Map<string, ModelsProviderConfig>();
  for (const [providerId, value] of Object.entries(providersRoot)) {
    if (!isRecord(value)) return undefined;
    const { apiKey, baseUrl, headers, authHeader } = value;
    // Pi's schema pins non-empty strings (minLength 1) for these provider fields.
    if (apiKey !== undefined && (typeof apiKey !== "string" || apiKey.length === 0)) return undefined;
    if (baseUrl !== undefined && (typeof baseUrl !== "string" || baseUrl.length === 0)) return undefined;
    if (headers !== undefined && !isStringRecord(headers)) return undefined;
    if (authHeader !== undefined && typeof authHeader !== "boolean") return undefined;
    providers.set(providerId, {
      apiKey,
      baseUrl,
      headers,
      authHeader: authHeader === true,
    });
  }
  return providers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** Removes a leading UTF-8 byte order mark (Pi `utils/text.js`). */
function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Strips `//` line comments and trailing commas from JSON, leaving string
 * literals untouched (Pi `dist/utils/json.js`).
 */
export function stripJsonComments(input: string): string {
  return input
    // Delete `//` line comments; keep quoted literals as-is.
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/gu, (_match, quoted: string | undefined) => quoted ?? "")
    // Strip commas in front of a closing brace/bracket; keep quoted literals as-is.
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/gu, (_match, quoted: string | undefined, tail: string | undefined) => quoted ?? tail ?? "");
}
