import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import AdmZip from "adm-zip";

import { projectVersion, root } from "./lib.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
  throw new Error("Usage: pnpm verify:vsix [archive.vsix]");
}
const path = resolve(args[0] ?? resolve(root, "artifacts", `FrostPi-${projectVersion()}.vsix`));
if (!existsSync(path)) throw new Error(`VSIX not found: ${path}`);
const zip = new AdmZip(path);
const entries = zip.getEntries().map((entry) => entry.entryName);
const normalizedEntries = new Set(entries.map((entry) => entry.toLowerCase()));
const required = [
  "extension/package.json",
  "extension/readme.md",
  "extension/license.txt",
  "extension/privacy.md",
  "extension/third_party_notices.md",
  "extension/dist/extension/extension.cjs",
  "extension/dist/pi-extensions/session-tree.js",
  "extension/dist/webview/webview.js",
  "extension/dist/webview/webview.css",
  "extension/dist/webview/assets/codicon.ttf",
  "extension/dist/webview/vendor/mermaid.min.js",
  "extension/assets/icon.png",
  "extension/assets/activity-bar.svg",
];
for (const entry of required) {
  if (!normalizedEntries.has(entry.toLowerCase())) throw new Error(`VSIX is missing ${entry}`);
}
const forbidden = entries.filter((entry) =>
  /(^|\/)(src|test|node_modules|\.vscode-test)(\/|$)/.test(entry)
  || /^extension\/pi-extensions\//.test(entry)
  || entry === "extension/build.mjs"
  || entry.endsWith(".map"),
);
if (forbidden.length) throw new Error(`VSIX contains forbidden files:\n${forbidden.join("\n")}`);
const notices = zip.readAsText(entries.find((entry) => entry.toLowerCase() === "extension/third_party_notices.md"));
if (!notices.includes("Copyright (c) 2026 narumiruna") || !notices.includes("Permission is hereby granted") || !notices.includes("Matteo Collina and Undici contributors")) {
  throw new Error("VSIX is missing bundled provider usage / HTTP client license notices.");
}
const webviewCss = zip.readAsText("extension/dist/webview/webview.css");
if (/url\(\s*["']?\/assets\//.test(webviewCss)) {
  throw new Error("Webview CSS contains a root-relative asset URL; packaged fonts will not resolve in VS Code.");
}
if (!webviewCss.includes("./assets/codicon.ttf")) {
  throw new Error("Webview CSS does not reference the packaged Codicon font with a relative URL.");
}
const manifest = JSON.parse(zip.readAsText("extension/package.json"));
if (manifest.publisher !== "frostime" || manifest.name !== "frostpi") {
  throw new Error(`Unexpected extension identity: ${manifest.publisher}.${manifest.name}`);
}
const size = statSync(path).size;
if (size > 8 * 1024 * 1024) throw new Error(`VSIX exceeds the 8 MB baseline budget (${size} bytes)`);
console.log(`Verified ${path}: ${entries.length} entries, ${(size / 1024 / 1024).toFixed(2)} MB`);
