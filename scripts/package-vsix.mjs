import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { ensureArtifacts, projectVersion, root, run } from "./lib.mjs";

run("pnpm", ["--dir", "apps/vscode", "build"]);
const artifacts = ensureArtifacts();
const output = resolve(artifacts, `FrostPi-${projectVersion()}.vsix`);
// Single product changelog lives at the monorepo root; copy it into the extension
// package root so vsce can include Marketplace-facing CHANGELOG.md.
const extensionChangelog = resolve(root, "apps/vscode/CHANGELOG.md");
copyFileSync(resolve(root, "CHANGELOG.md"), extensionChangelog);
run("pnpm", ["exec", "vsce", "package", "--no-dependencies", "--out", output], {
  cwd: resolve(root, "apps/vscode"),
});
if (!existsSync(output)) throw new Error(`VSIX was not created: ${output}`);
console.log(`Created ${output}`);
