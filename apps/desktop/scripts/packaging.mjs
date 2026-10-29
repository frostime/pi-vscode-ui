import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Runtime resource inventory and constants shared by Desktop build, packaging and verification. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const desktopRoot = resolve(repositoryRoot, "apps/desktop");
export const buildOutput = resolve(desktopRoot, "dist");
export const artifactsRoot = resolve(repositoryRoot, "artifacts");
export const productName = "FrostPi";
export const targetPlatform = "win32";
export const targetArch = "x64";

export const piExtensionNames = ["session-tree", "question-tool"];
export const buildInfoFile = "BUILD_INFO.json";
export const archivePayloadFiles = [
  "FrostPi.exe", "backend.cjs", "package.json", "LICENSE", "THIRD_PARTY_NOTICES.md",
  "README.txt", "Cargo.lock", "NATIVE_NOTICES.md",
  ...piExtensionNames.map((name) => `pi-extensions/${name}.js`),
];
export const archiveFiles = [...archivePayloadFiles, buildInfoFile];

// Release executables resolve the backend and Pi extensions beside themselves.
// Use the same resource copies for the development executable and ZIP staging.
export function copyRuntimeFiles(destination, source = buildOutput) {
  mkdirSync(join(destination, "pi-extensions"), { recursive: true });
  cpSync(join(source, "backend.cjs"), join(destination, "backend.cjs"));
  for (const name of piExtensionNames) {
    cpSync(join(source, "pi-extensions", `${name}.js`), join(destination, "pi-extensions", `${name}.js`));
  }
}

const versionSource = resolve(repositoryRoot, "apps/vscode/package.json");

/** The product version keeps its single authority in the extension manifest. */
export function productVersion() {
  return JSON.parse(readFileSync(versionSource, "utf8")).version;
}

export function distributedArchive() {
  return resolve(artifactsRoot, `${productName}-${productVersion()}-${targetPlatform}-${targetArch}.zip`);
}
