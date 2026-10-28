import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { root, run } from "./lib.mjs";

const vscodeOnly = process.argv.includes("--vscode");
for (const packageName of ["@frostime/pi-rpc", "@frostime/provider-usage", "@frostime/pi-client", "frostpi", "@frostime/frostpi-desktop"]) {
  if (vscodeOnly && packageName === "@frostime/frostpi-desktop") continue;
  run("pnpm", ["--filter", packageName, "build"]);
}

for (const relative of [
  "apps/vscode/dist/extension/extension.cjs",
  "apps/vscode/dist/webview/webview.js",
  "apps/vscode/dist/webview/webview.css",
]) {
  const path = resolve(root, relative);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing build output: ${relative}`);
}
