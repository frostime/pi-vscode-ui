import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Packaging constants shared by the Desktop packager and its archive verification. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const desktopRoot = resolve(repositoryRoot, "apps/desktop");
export const buildOutput = resolve(desktopRoot, "dist");
export const artifactsRoot = resolve(repositoryRoot, "artifacts");
export const productName = "FrostPi";
export const targetPlatform = "win32";
export const targetArch = "x64";

const versionSource = resolve(repositoryRoot, "apps/vscode/package.json");

/** The product version keeps its single authority in the extension manifest. */
export function productVersion() {
  return JSON.parse(readFileSync(versionSource, "utf8")).version;
}

export function distributedArchive() {
  return resolve(artifactsRoot, `${productName}-${productVersion()}-${targetPlatform}-${targetArch}.zip`);
}
