import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { run } from "../../../scripts/lib.mjs";
import { repositoryRoot } from "./packaging.mjs";

const sharedNotices = resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md");
const importer = "@frostime/frostpi-desktop";
const licenseFilePattern = /^(licen[cs]e|notice|copyright)([.\-_].*)?$/i;

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}

/**
 * Production dependencies of the Desktop product, taken from the same pnpm
 * license inventory that generates the shared notices file. Development-only
 * packaging tools are excluded because they are not shipped.
 */
function desktopProductionLicenses() {
  const groups = JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json", `--filter=${importer}`], { capture: true }));
  const rows = [];
  for (const [license, entries] of Object.entries(groups)) {
    for (const entry of entries) {
      rows.push({
        name: entry.name,
        versions: [...entry.versions].sort().join(", "),
        license,
        homepage: typeof entry.homepage === "string" ? entry.homepage : "",
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.versions.localeCompare(b.versions));
}

function listedPackages(text) {
  return new Set([...text.matchAll(/^\| ([^ |]+) \|/gm)].map((match) => match[1]));
}

/** pnpm keeps every installed version under its virtual store path. */
function installedPackageRoot(name, version) {
  return resolve(repositoryRoot, "node_modules/.pnpm", `${name.replace("/", "+")}@${version}`, "node_modules", name);
}

/** The license and notice files the installed package actually ships. */
function installedLicenseFiles(name, version) {
  const root = installedPackageRoot(name, version);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseFilePattern.test(entry.name))
    .map((entry) => ({ file: entry.name, text: readFileSync(resolve(root, entry.name), "utf8").trim() }))
    .filter((entry) => entry.text.length > 0);
}

function primaryVersion(versions) {
  return versions.split(",")[0].trim();
}

function licenseSections(additions) {
  const withoutText = additions.filter((addition) => addition.licenseFiles.length === 0).map((addition) => addition.name);
  if (withoutText.length > 0) {
    throw new Error(`No installed license text for Desktop runtime dependencies: ${withoutText.join(", ")}`);
  }
  return additions.map((addition) => {
    const files = addition.licenseFiles
      .map((entry) => `\`${entry.file}\`\n\n\`\`\`text\n${entry.text.replaceAll("```", "ˋˋˋ")}\n\`\`\``)
      .join("\n\n");
    return `### ${addition.name} ${addition.versions} (${addition.license})\n\n${files}\n`;
  }).join("\n");
}

/**
 * The shared notices file covers the workspace production inventory, but Desktop
 * runtime dependencies such as `ajv` and `jsonc-parser` (and their closure) are
 * not listed there. The packaged copy reuses the shared table, appends the
 * missing rows, and includes the license text shipped by each installed package
 * so attribution does not depend on a link.
 */
export function desktopNoticesText() {
  const shared = readFileSync(sharedNotices, "utf8");
  const listed = listedPackages(shared);
  const missing = desktopProductionLicenses().filter((row) => !listed.has(row.name));
  if (missing.length === 0) return shared;
  const additions = missing.map((row) => ({
    ...row,
    licenseFiles: installedLicenseFiles(row.name, primaryVersion(row.versions)),
  }));
  const rows = additions
    .map((row) => `| ${escapeCell(row.name)} | ${escapeCell(row.versions)} | ${escapeCell(row.license)} | ${row.homepage ? `<${row.homepage}>` : "—"} |`)
    .join("\n");
  return `${shared.trimEnd()}

## Desktop runtime additions

These production dependencies are shipped by the Desktop application and are not part of the shared table above. Copyright remains with their respective authors. The license text below is copied from each installed package.

| Package | Version | License | Project |
|---|---:|---|---|
${rows}

### Included license texts

${licenseSections(additions)}`;
}
