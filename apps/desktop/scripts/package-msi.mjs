import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildJavaScript } from "../../../scripts/build.mjs";
import { assertNoArguments } from "../../../scripts/lib.mjs";
import { desktopNoticesText } from "./desktop-notices.mjs";
import {
  finalizeMsiArtifacts,
  msiBuildEnvironment,
  msiBuildOverride,
  msiSigningConfiguration,
} from "./msi-contract.mjs";
import { nativeNoticesText } from "./native-notices.mjs";
import {
  artifactsRoot,
  buildOutput,
  desktopRoot,
  msiAssetPaths,
  msiBundleDirectory,
  msiSupportDirectory,
  productName,
  productVersion,
  repositoryRoot,
  writeRuntimePackageJson,
} from "./packaging.mjs";

assertNoArguments("pnpm package:desktop:msi");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("MSI packaging supports Windows x64 only.");

const tauriCli = resolve(desktopRoot, "node_modules/@tauri-apps/cli/tauri.js");
const version = productVersion();
const signing = msiSigningConfiguration();
// buildJavaScript also launches children using process.env.
delete process.env.TAURI_SIGNING_PRIVATE_KEY;
delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
const buildEnvironment = msiBuildEnvironment();

function runCommand(command, args, environment, capture = false) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    env: environment,
    encoding: "utf8",
    // Do not log signer output, which may include signing material.
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(command)} ${args[0]} failed with exit code ${result.status}.`);
}

function stageMsiSupportFiles() {
  mkdirSync(msiSupportDirectory, { recursive: true });
  cpSync(resolve(repositoryRoot, "LICENSE"), join(msiSupportDirectory, "LICENSE"));
  writeFileSync(join(msiSupportDirectory, "THIRD_PARTY_NOTICES.md"), desktopNoticesText());
  writeFileSync(join(msiSupportDirectory, "NATIVE_NOTICES.md"), nativeNoticesText());
  cpSync(resolve(desktopRoot, "src-tauri/Cargo.lock"), join(msiSupportDirectory, "Cargo.lock"));
  writeRuntimePackageJson(join(msiSupportDirectory, "package.json"));
}

function builtMsi() {
  const prefix = `${productName}_${version}_x64_`;
  const names = readdirSync(msiBundleDirectory).filter((name) => name.startsWith(prefix) && name.endsWith(".msi"));
  if (names.length !== 1) throw new Error(`Expected one ${prefix}<language>.msi in ${msiBundleDirectory}, found ${names.length}.`);
  return join(msiBundleDirectory, names[0]);
}

console.log("[package:msi] rebuilding JavaScript, backend and Pi extensions");
buildJavaScript("desktop");
runCommand("cargo", ["fetch", "--locked", "--manifest-path", "src-tauri/Cargo.toml"], buildEnvironment);
stageMsiSupportFiles();

// --config participates in compilation, so the installed EXE embeds the updater key.
const overridePath = resolve(buildOutput, "tauri.msi.conf.json");
writeFileSync(overridePath, `${JSON.stringify(msiBuildOverride(signing.publicKey), null, 2)}\n`);
console.log("[package:msi] compiling Rust and bundling the MSI");
runCommand(process.execPath, [tauriCli, "build", "--config", overridePath, "--bundles", "msi", "--", "--locked"], buildEnvironment);

mkdirSync(artifactsRoot, { recursive: true });
const directory = mkdtempSync(join(artifactsRoot, ".msi-"));
try {
  const staged = msiAssetPaths(version, directory);
  cpSync(builtMsi(), staged.msi);
  console.log(`[package:msi] signing ${basename(staged.msi)}`);
  runCommand(process.execPath, [tauriCli, "signer", "sign", "--app-version", version, staged.msi], signing.environment, true);
  finalizeMsiArtifacts({ version, paths: staged });

  const paths = msiAssetPaths(version);
  // Atomic file replacement; publish the manifest only after its installer and signature.
  for (const asset of ["msi", "signature", "manifest"]) renameSync(staged[asset], paths[asset]);
  console.log(`Packaged Windows Desktop MSI: ${paths.msi} (${statSync(paths.msi).size} bytes)`);
  console.log(`Update manifest: ${paths.manifest}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
