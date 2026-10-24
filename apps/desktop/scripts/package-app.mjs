import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { packager } from "@electron/packager";
import AdmZip from "adm-zip";
import pngToIco from "png-to-ico";

import { desktopNoticesText } from "./desktop-notices.mjs";
import { powerShellLiteral, runPowerShell } from "./powershell.mjs";
import {
  applicationPayload, artifactsRoot, buildOutput, distributionFiles, distributionReadme,
  distributedArchive, electronInstallation, productName, productVersion, repositoryRoot, targetArch, targetPlatform,
} from "./packaging.mjs";

const requiredBuildFiles = ["main.cjs", "preload.cjs", "renderer/index.html", "pi-extensions/session-tree.js", "pi-extensions/question-tool.js"];
const brandIcon = resolve(repositoryRoot, "apps/vscode/assets/icon.png");
const electronZipCache = resolve(tmpdir(), "frostpi-electron-zips");

/**
 * The cache name and metadata describe Windows x64, so packaging must refuse to
 * relabel another platform's Electron distribution as this target.
 */
function requireSupportedTarget(installation) {
  if (process.platform !== targetPlatform || process.arch !== targetArch) {
    throw new Error(`Packaging supports only ${targetPlatform}-${targetArch}; this host is ${process.platform}-${process.arch}.`);
  }
  const distVersion = readFileSync(resolve(installation.distribution, "version"), "utf8").trim();
  if (distVersion !== installation.version) {
    throw new Error(`Installed Electron distribution is ${distVersion}, but the electron package declares ${installation.version}.`);
  }
  const executable = resolve(installation.distribution, "electron.exe");
  if (!isWindowsX64Executable(executable)) {
    throw new Error(`Installed Electron binary is missing or not a Windows x64 executable: ${executable}`);
  }
}

/** Reads the PE machine type instead of trusting the file name. */
function isWindowsX64Executable(path) {
  if (!existsSync(path)) return false;
  const header = Buffer.alloc(4096);
  const descriptor = openSync(path, "r");
  try { readSync(descriptor, header, 0, header.length, 0); }
  finally { closeSync(descriptor); }
  if (header.toString("latin1", 0, 2) !== "MZ") return false;
  const peOffset = header.readUInt32LE(0x3c);
  if (peOffset + 6 > header.length) return false;
  if (header.subarray(peOffset, peOffset + 4).toString("hex") !== "50450000") return false;
  return header.readUInt16LE(peOffset + 4) === 0x8664;
}

function requireBuildOutput() {
  for (const file of requiredBuildFiles) {
    const path = resolve(buildOutput, file);
    if (!existsSync(path)) throw new Error(`Desktop build output is missing: ${path}. Run "pnpm --dir apps/desktop build" first.`);
  }
}

/**
 * A packaged app must not carry the repository. Staging copies only the built
 * runtime payload, so tests, sources, development dependencies and user profiles
 * cannot reach the archive by accident.
 */
async function stageApplication(stagingRoot) {
  const applicationRoot = resolve(stagingRoot, "app");
  mkdirSync(resolve(applicationRoot, "dist"), { recursive: true });
  cpSync(resolve(buildOutput, "main.cjs"), resolve(applicationRoot, "dist/main.cjs"));
  cpSync(resolve(buildOutput, "preload.cjs"), resolve(applicationRoot, "dist/preload.cjs"));
  cpSync(resolve(buildOutput, "renderer"), resolve(applicationRoot, "dist/renderer"), { recursive: true });
  cpSync(resolve(buildOutput, "pi-extensions"), resolve(applicationRoot, "dist/pi-extensions"), { recursive: true });
  cpSync(resolve(repositoryRoot, "LICENSE"), resolve(applicationRoot, "LICENSE"));
  // Shared notices plus the Desktop runtime additions that file does not list.
  writeFileSync(resolve(applicationRoot, "THIRD_PARTY_NOTICES.md"), desktopNoticesText());
  writeFileSync(resolve(applicationRoot, "package.json"), `${JSON.stringify(runtimeManifest(), null, 2)}\n`);
  const icon = resolve(stagingRoot, `${productName}.ico`);
  writeFileSync(icon, await pngToIco(brandIcon));
  return { applicationRoot, icon };
}

/** The runtime manifest stays minimal; the product version still comes from its single authority. */
function runtimeManifest() {
  return {
    name: "frostpi-desktop",
    productName,
    version: productVersion(),
    description: "FrostPi Desktop",
    license: "AGPL-3.0-only",
    private: true,
    type: "module",
    main: "dist/main.cjs",
  };
}

/** Windows' own Compress-Archive keeps this dependency-free and available offline. */
function compressArchive(source, destination) {
  const script = `$ErrorActionPreference = 'Stop'; Compress-Archive -Path ${powerShellLiteral(source)} -DestinationPath ${powerShellLiteral(destination)} -Force`;
  runPowerShell(script);
  if (!existsSync(destination)) throw new Error(`Compress-Archive produced no archive: ${destination}`);
}

function isCompleteElectronRelease(archive) {
  if (!existsSync(archive) || statSync(archive).size === 0) return false;
  try {
    return new AdmZip(archive).getEntries().some((entry) => /^electron\.exe$/i.test(entry.entryName));
  } catch {
    return false;
  }
}

/**
 * @electron/packager needs an Electron release archive. Reuse the installed,
 * already-verified distribution instead of downloading another copy. The cache
 * is only accepted after a structure check, and a rebuild publishes through a
 * temporary file so an interrupted run cannot masquerade as a valid cache.
 */
function electronReleaseArchive(installation) {
  mkdirSync(electronZipCache, { recursive: true });
  const archive = resolve(electronZipCache, `electron-v${installation.version}-${targetPlatform}-${targetArch}.zip`);
  if (isCompleteElectronRelease(archive)) return archive;
  const temporary = resolve(electronZipCache, `${basename(archive, ".zip")}.partial-${process.pid}.zip`);
  try {
    compressArchive(resolve(installation.distribution, "*"), temporary);
    if (!isCompleteElectronRelease(temporary)) throw new Error(`Electron release archive is incomplete: ${temporary}`);
    renameSync(temporary, archive);
  } finally {
    rmSync(temporary, { force: true });
  }
  return archive;
}

async function packageApplication({ applicationRoot, icon }, stagingRoot, installation) {
  const [packagedRoot] = await packager({
    dir: applicationRoot,
    out: resolve(stagingRoot, "packaged"),
    name: productName,
    appVersion: productVersion(),
    platform: targetPlatform,
    arch: targetArch,
    electronVersion: installation.version,
    electronZipDir: electronZipCache,
    // External Pi artifacts stay real files under resources/app; nothing runs from an ASAR.
    asar: false,
    prune: false,
    overwrite: true,
    icon,
    win32metadata: {
      CompanyName: "frostime",
      FileDescription: "FrostPi Desktop",
      InternalName: productName,
      OriginalFilename: `${productName}.exe`,
      ProductName: productName,
    },
  });
  const resourcesApp = resolve(packagedRoot, "resources/app");
  if (!existsSync(resolve(resourcesApp, "dist/main.cjs"))) throw new Error(`Packaged app payload is missing: ${resourcesApp}`);
  if (existsSync(resolve(packagedRoot, "resources/app.asar"))) throw new Error("Packaged app unexpectedly uses an ASAR archive.");
  return packagedRoot;
}

/** The archive root matches the product, so extracting yields "FrostPi/FrostPi.exe". */
function addDistributionFiles(portableRoot) {
  const content = { "README.txt": distributionReadme };
  for (const file of distributionFiles) {
    const text = content[file]?.();
    if (text === undefined) throw new Error(`No content defined for distribution file: ${file}`);
    // Notepad on Chinese Windows needs the byte-order mark to read UTF-8 text.
    writeFileSync(resolve(portableRoot, file), `\uFEFF${text.replaceAll("\n", "\r\n")}`);
  }
}

function archivePayloadSizes(root) {
  let files = 0;
  let bytes = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else { files += 1; bytes += statSync(path).size; }
    }
  };
  walk(root);
  return { files, bytes };
}

const stagingRoot = mkdtempSync(resolve(tmpdir(), "frostpi-desktop-package-"));
try {
  requireBuildOutput();
  mkdirSync(artifactsRoot, { recursive: true });
  const installation = electronInstallation();
  requireSupportedTarget(installation);
  electronReleaseArchive(installation);
  const staged = await stageApplication(stagingRoot);
  const packagedRoot = await packageApplication(staged, stagingRoot, installation);
  const portableRoot = resolve(stagingRoot, productName);
  renameSync(packagedRoot, portableRoot);
  addDistributionFiles(portableRoot);
  // Build beside the target and publish by rename, so a failure keeps the previous archive usable.
  const output = distributedArchive();
  const temporaryOutput = resolve(artifactsRoot, `${basename(output, ".zip")}.partial-${process.pid}.zip`);
  try {
    compressArchive(portableRoot, temporaryOutput);
    const archive = new AdmZip(temporaryOutput);
    // Compress-Archive can emit Windows separators; ZIP entry names use forward slashes.
    if (archive.getEntries().some((entry) => entry.entryName.includes("\\"))) {
      for (const entry of archive.getEntries()) entry.entryName = entry.entryName.replaceAll("\\", "/");
      archive.writeZip(temporaryOutput);
    }
    const entries = archive.getEntries().map((entry) => entry.entryName);
    const required = [`${productName}/${productName}.exe`, `${productName}/resources/app/dist/main.cjs`, ...distributionFiles.map((file) => `${productName}/${file}`)];
    if (required.some((file) => !entries.includes(file)) || entries.some((file) => !file.startsWith(`${productName}/`))) {
      throw new Error("The completed Desktop archive has an unexpected layout; the previous artifact was preserved.");
    }
    renameSync(temporaryOutput, output);
  } finally {
    rmSync(temporaryOutput, { force: true });
  }
  console.log(`Packaged ${applicationPayload.files.length} files plus ${applicationPayload.directories.length} directories with Electron ${installation.version}.`);
  console.log(`Payload: ${archivePayloadSizes(resolve(portableRoot, "resources/app")).files} files; archive root: ${distributionFiles.join(", ")}`);
  console.log(`Created ${output} (${(statSync(output).size / 1024 / 1024).toFixed(1)} MiB)`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
