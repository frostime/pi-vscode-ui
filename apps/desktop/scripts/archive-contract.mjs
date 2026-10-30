import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { archiveFiles, archivePayloadFiles, buildInfoFile, productName, productVersion, repositoryRoot, targetArch, targetPlatform } from "./packaging.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildSource(directory = repositoryRoot) {
  try {
    const options = { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
      dirty: execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], options).trim().length > 0,
    };
  } catch {
    // Source archives and machines without Git can build, but cannot claim commit provenance.
    return { commit: null, dirty: null };
  }
}

export function createBuildInfo(directory) {
  return {
    schemaVersion: 1,
    product: productName,
    version: productVersion(),
    platform: targetPlatform,
    arch: targetArch,
    builtAt: new Date().toISOString(),
    source: buildSource(),
    files: Object.fromEntries(archivePayloadFiles.map((file) => [file, sha256(readFileSync(join(directory, file)))])),
  };
}

/** Payload hashes detect mix-ups/corruption, not malicious changes or exact dirty-source provenance. */
export function verifyArchive(zip) {
  const expected = new Set(archiveFiles.map((file) => `${productName}/${file}`));
  const directories = new Set([...expected].map((file) => `${posix.dirname(file)}/`));
  for (const entry of zip.getEntries()) {
    assert.ok(entry.isDirectory ? directories.has(entry.entryName) : expected.delete(entry.entryName), `Unexpected/duplicate archive entry: ${entry.entryName}`);
  }
  assert.equal(expected.size, 0, `Incomplete Desktop archive: ${[...expected].join(", ")}`);

  const info = JSON.parse(zip.readAsText(`${productName}/${buildInfoFile}`));
  assert.equal(info.schemaVersion, 1, "Unsupported Desktop build information");
  assert.equal(info.product, productName);
  assert.equal(info.platform, targetPlatform);
  assert.equal(info.arch, targetArch);
  assert.ok(typeof info.version === "string" && info.version.length > 0, "Missing product version");
  assert.ok(typeof info.builtAt === "string" && Number.isFinite(Date.parse(info.builtAt)), "Invalid build time");
  assert.ok(info.source?.commit === null || /^[a-f0-9]{40,64}$/.test(info.source?.commit), "Invalid source commit");
  assert.ok(info.source?.dirty === null || typeof info.source?.dirty === "boolean", "Invalid source state");
  assert.deepEqual(Object.keys(info.files).sort(), [...archivePayloadFiles].sort(), "Incomplete payload hash inventory");
  for (const file of archivePayloadFiles) {
    assert.equal(sha256(zip.readFile(`${productName}/${file}`)), info.files[file], `Payload SHA-256 mismatch: ${file}`);
  }
  // An explicitly supplied older archive is checked against itself, not the current checkout's version.
  assert.equal(JSON.parse(zip.readAsText(`${productName}/package.json`)).version, info.version, "Inconsistent package version");
  assert.match(zip.readAsText(`${productName}/NATIVE_NOTICES.md`), /## tauri /);
  assert.match(zip.readAsText(`${productName}/NATIVE_NOTICES.md`), /Mozilla Public License Version 2.0/);
  assert.equal(zip.readFile(`${productName}/FrostPi.exe`).subarray(0, 2).toString(), "MZ");
  return info;
}
