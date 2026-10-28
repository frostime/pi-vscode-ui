import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { buildSource, sha256, verifyArchive } from "./archive-contract.mjs";
import { distributedArchive } from "./packaging.mjs";

/** Validate the exact verified ZIP before producing uploadable release assets. Never rebuild here. */
export function prepareReleaseAssets(archive, tag, expectedCommit) {
  const bytes = readFileSync(archive);
  const info = verifyArchive(new AdmZip(bytes));
  assert.equal(tag, `v${info.version}`, "Release tag does not match the Desktop archive version");
  assert.ok(expectedCommit, "Release preparation requires a known source commit");
  assert.equal(info.source.commit, expectedCommit, "Desktop archive was built from a different commit");
  assert.equal(info.source.dirty, false, "A dirty or unknown source build cannot be published as a Desktop release");

  const report = JSON.parse(readFileSync(`${archive}.verification.json`, "utf8"));
  const hash = sha256(bytes);
  assert.equal(report.sha256, hash, "GUI verification report belongs to a different ZIP");
  assert.equal(report.ok, true, "Desktop GUI verification did not pass");
  assert.equal(report.checks?.archive, "passed", "Desktop archive verification did not pass");
  assert.equal(report.checks?.smoke, "passed", "Desktop GUI smoke did not pass");
  assert.equal(report.smoke?.ok, true, "Missing successful native smoke result");
  assert.deepEqual(report.buildInfo, info, "Verification report has different build information");

  const checksum = `${archive}.sha256`;
  writeFileSync(checksum, `${hash}  ${basename(archive)}\n`);
  return { archive, checksum, verification: `${archive}.verification.json` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = buildSource();
  assert.equal(source.dirty, false, "Prepare Desktop release assets from a clean Git checkout");
  const assets = prepareReleaseAssets(distributedArchive(), process.argv[2], source.commit);
  console.log(`Prepared verified Desktop release assets: ${assets.archive}`);
}
