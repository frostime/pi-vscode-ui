/**
 * Deterministic test fixtures: temporary files and explicit fake environment
 * maps only. Tests must never read the developer's real configuration and
 * must not inherit process credentials; assertions that touch credential
 * values compare internally and never print them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempAgentDir {
  root: string;
  authPath: string;
  modelsPath: string;
  writeAuthJson(content: string): void;
  writeModelsJson(content: string): void;
  dispose(): void;
}

/** Creates a temporary directory holding auth.json/models.json test fixtures. */
export function createTemporaryAgentDir(): TempAgentDir {
  const root = mkdtempSync(join(tmpdir(), "provider-usage-test-"));
  const authPath = join(root, "auth.json");
  const modelsPath = join(root, "models.json");
  return {
    root,
    authPath,
    modelsPath,
    writeAuthJson(content: string): void {
      writeFileSync(authPath, content, "utf-8");
    },
    writeModelsJson(content: string): void {
      writeFileSync(modelsPath, content, "utf-8");
    },
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Explicit fake environment; replaces the process environment in resolution. */
export function fakeEnv(mapping: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...mapping };
}

/** Boolean predicate: true when `needle` appears in `text`. Safe with secrets. */
export function leaksValue(needle: string, text: string): boolean {
  return needle.length > 8 && text.includes(needle);
}

/** Boolean comparison of a resolved Authorization to a token value (`Bearer <token>`). */
export function bearerEquals(authorization: string | undefined, expectedToken: string): boolean {
  return authorization === `Bearer ${expectedToken}`;
}

/** Boolean comparison of a resolved Authorization to an exact expected value. */
export function authorizationEquals(authorization: string | undefined, expectedAuthorization: string): boolean {
  return authorization === expectedAuthorization;
}
