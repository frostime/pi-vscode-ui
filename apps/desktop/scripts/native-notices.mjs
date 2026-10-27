import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { desktopRoot } from "./packaging.mjs";

// These published crates omit license files. Copies are pinned to their source revision.
const supplemental = {
  "alloc-stdlib@0.3.0": ["alloc-stdlib-0.3.0.txt", "https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE"],
  "clipboard-win@5.4.3": ["clipboard-win-5.4.3.txt", "https://github.com/DoumanAsh/clipboard-win/blob/ed27008ae5d1f10cfbb266de039f0fb35fd05a56/LICENSE"],
  "selectors@0.38.0": ["MPL-2.0.txt", "https://github.com/servo/stylo/tree/572ecba2d1600e7c3d490586692a209faf703baa/selectors"],
  ...Object.fromEntries(["webview2-com@0.39.1", "webview2-com-sys@0.39.1", "webview2-com-macros@0.8.1"].map((name) => [name, ["webview2-rs.txt", "https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE"]])),
};

/** Reproducible offline inventory; new crates without attribution fail packaging. */
export function nativeNoticesText() {
  const result = spawnSync("cargo", ["metadata", "--locked", "--offline", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", "--manifest-path", "src-tauri/Cargo.toml"], { cwd: desktopRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error("Could not read the locked Windows Rust dependency inventory.");
  const metadata = JSON.parse(result.stdout);
  const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
  const packages = metadata.packages.filter((entry) => entry.source && resolved.has(entry.id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const sections = packages.map((entry) => {
    const root = dirname(entry.manifest_path);
    const files = readdirSync(root, { withFileTypes: true }).filter((file) => file.isFile() && /^(licen[cs]e|notice|copyright)([.\-_].*)?$/i.test(file.name)).map((file) => join(root, file.name));
    if (entry.license_file) files.push(join(root, entry.license_file));
    const extra = supplemental[`${entry.name}@${entry.version}`];
    if (!files.length && extra) files.push(join(import.meta.dirname, "licenses", extra[0]));
    if (!files.length || !entry.license) throw new Error(`Missing native license attribution: ${entry.name}@${entry.version}`);
    const texts = [...new Set(files)].map((file) => readFileSync(file, "utf8").trim());
    return `## ${entry.name} ${entry.version}\n\nLicense: ${entry.license}\nSource: ${extra?.[1] ?? entry.repository ?? `https://crates.io/crates/${entry.name}/${entry.version}`}\n\n${texts.map((text) => `\`\`\`text\n${text.replaceAll("```", "ˋˋˋ")}\n\`\`\``).join("\n\n")}\n`;
  });
  return `# Windows native dependency notices\n\nLocked Windows dependency graph (${packages.length} crates), including build tools. Source links identify unchanged upstream code. The complete dependency versions are in Cargo.lock.\n\n${sections.join("\n")}`;
}
