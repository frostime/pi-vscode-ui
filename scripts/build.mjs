import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { root, run } from "./lib.mjs";
import { buildSteps, scopeFromArgs } from "./workspaces.mjs";

const scope = scopeFromArgs(process.argv.slice(2));
console.log(`[build] scope: ${scope}`);
for (const { packageName, script } of buildSteps(scope)) {
  run("pnpm", ["--filter", packageName, script]);
}

const productOutputs = {
  vscode: [
    "apps/vscode/dist/extension/extension.cjs",
    "apps/vscode/dist/webview/webview.js",
    "apps/vscode/dist/webview/webview.css",
  ],
  desktop: ["apps/desktop/dist/backend.cjs", "apps/desktop/dist/renderer/index.html"],
};
for (const product of scope === "all" ? Object.keys(productOutputs) : [scope]) {
  for (const relative of productOutputs[product]) {
    const path = resolve(root, relative);
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing build output: ${relative}`);
  }
}
