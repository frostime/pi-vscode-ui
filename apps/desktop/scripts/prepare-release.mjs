import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { buildSource, sha256, verifyArchive } from "./archive-contract.mjs";
import { distributedArchive } from "./packaging.mjs";

/**
 * Validate archive integrity/provenance and write its upload checksum. Never rebuild here.
 * SPEC: GUI acceptance belongs to local pre-tag testing, not hosted publication.
 * This checksum does not claim the archive passed GUI verification.
 */
export function prepareReleaseAssets(archive, tag, expectedCommit) {
  const bytes = readFileSync(archive);
  const info = verifyArchive(new AdmZip(bytes));
  assert.equal(tag, `v${info.version}`, "Release tag does not match the Desktop archive version");
  assert.ok(expectedCommit, "Release preparation requires a known source commit");
  assert.equal(info.source.commit, expectedCommit, "Desktop archive was built from a different commit");
  assert.equal(info.source.dirty, false, "A dirty or unknown source build cannot be published as a Desktop release");

  const checksum = `${archive}.sha256`;
  writeFileSync(checksum, `${sha256(bytes)}  ${basename(archive)}\n`);
  return { archive, checksum };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, "Usage: node apps/desktop/scripts/prepare-release.mjs <tag>");
  const source = buildSource();
  assert.equal(source.dirty, false, "Prepare Desktop release assets from a clean Git checkout");
  const assets = prepareReleaseAssets(distributedArchive(), process.argv[2], source.commit);
  console.log(`Prepared Desktop release assets (archive checks only): ${assets.archive}`);
}
