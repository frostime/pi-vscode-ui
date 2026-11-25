import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export const piExtensionNames = ["session-tree", "question-tool", "side-question"];
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

/**
 * The runtime package.json travels beside backend.cjs and the Pi extensions in both
 * deliveries. Its `type: module` marks the extension files as ESM; do not drop it
 * from one packaging route.
 */
export function runtimePackageMetadata() {
  return { name: "frostpi-desktop", private: true, type: "module", version: productVersion() };
}

export function writeRuntimePackageJson(destination) {
  writeFileSync(destination, `${JSON.stringify(runtimePackageMetadata())}\n`);
}

export function distributedArchive() {
  return resolve(artifactsRoot, `${productName}-${productVersion()}-${targetPlatform}-${targetArch}.zip`);
}

// MSI delivery reuses the ZIP's product identity and runtime inventory. The updater
// target is fixed because the Rust updater selects this exact platform key.
export const updateTarget = "windows-x86_64-msi";
export const updateManifestName = "FrostPi-desktop-update.json";
// Everything the MSI must install beside the bundled executable. package.json is
// runtime metadata, not a notice, so the inventory keeps an accurate name.
export const msiSupportFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md", "NATIVE_NOTICES.md", "Cargo.lock", "package.json"];
export const msiSupportDirectory = resolve(buildOutput, "msi");
export const msiBundleDirectory = resolve(desktopRoot, "src-tauri/target/release/bundle/msi");

/** Local release assets for one MSI build. The update manifest is shared by versions. */
export function msiAssetPaths(version = productVersion(), root = artifactsRoot) {
  const base = resolve(root, `${productName}-${version}-${targetPlatform}-${targetArch}`);
  return {
    msi: `${base}.msi`,
    signature: `${base}.msi.sig`,
    manifest: resolve(root, updateManifestName),
  };
}

/** The versioned release URL clients receive through the update manifest. */
// Keep the repository/tag shape aligned with plugins.updater.endpoints in tauri.conf.json.
export function msiDownloadUrl(version = productVersion()) {
  return `https://github.com/frostime/pi-vscode-ui/releases/download/v${version}/${productName}-${version}-${targetPlatform}-${targetArch}.msi`;
}
