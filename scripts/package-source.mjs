import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import AdmZip from "adm-zip";

import { assertNoArguments, ensureArtifacts, projectVersion, root } from "./lib.mjs";

assertNoArguments("pnpm package:source");
const artifacts = ensureArtifacts();
const output = resolve(artifacts, `FrostPi-${projectVersion()}-source.zip`);
const excludedNames = new Set(["node_modules", ".git", ".vscode-test", "coverage", ".DS_Store"]);
const excludedFiles = new Set([basename(output), "FrostPi-latest-source.zip"]);
const zip = new AdmZip();

function visit(path) {
  const name = basename(path);
  if (excludedNames.has(name) || excludedFiles.has(name)) return;
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const child of readdirSync(path).sort()) visit(resolve(path, child));
    return;
  }
  if (path.endsWith(".map") || path.endsWith(".tsbuildinfo")) return;
  const archiveName = relative(root, path).replaceAll("\\", "/");
  zip.addLocalFile(path, archiveName.slice(0, Math.max(0, archiveName.lastIndexOf("/"))), basename(archiveName));
}

for (const child of readdirSync(root).sort()) visit(resolve(root, child));
zip.writeZip(output);
if (!existsSync(output)) throw new Error(`Source archive was not created: ${output}`);
console.log(`Created ${output}`);
