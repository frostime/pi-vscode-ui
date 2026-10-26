/**
 * One-shot Marketplace publish: build → copy root changelog → vsce publish.
 *
 * Usage:
 *   pnpm publish:marketplace
 *   pnpm publish:marketplace -- --pre-release
 *   VSCE_PAT=... pnpm publish:marketplace
 *
 * Credentials: VSCE_PAT env, or prior `vsce login frostime`.
 * Does not bump version; set version with `pnpm version:set` first.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { ensureArtifacts, projectVersion, root, run } from "./lib.mjs";

const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const version = projectVersion();
const extensionDir = resolve(root, "apps/vscode");
const extensionChangelog = resolve(extensionDir, "CHANGELOG.md");

console.log(`Publishing frostime.frostpi@${version} to VS Code Marketplace…`);

run("pnpm", ["--dir", "apps/vscode", "build"]);
copyFileSync(resolve(root, "CHANGELOG.md"), extensionChangelog);

// Keep a local copy of the same tree that will be published (audit / GitHub release reuse).
const artifacts = ensureArtifacts();
const localVsix = resolve(artifacts, `FrostPi-${version}.vsix`);
run("pnpm", ["exec", "vsce", "package", "--no-dependencies", "--out", localVsix], {
  cwd: extensionDir,
});
if (!existsSync(localVsix)) throw new Error(`Local VSIX was not created: ${localVsix}`);
console.log(`Packaged ${localVsix}`);

const publishArgs = ["exec", "vsce", "publish", "--no-dependencies", ...extraArgs];
if (process.env.VSCE_PAT) {
  publishArgs.push("-p", process.env.VSCE_PAT);
}
run("pnpm", publishArgs, { cwd: extensionDir });

console.log(`Published frostime.frostpi@${version}`);
console.log(`Local artifact: ${localVsix}`);
