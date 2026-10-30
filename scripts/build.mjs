import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { root, run } from "./lib.mjs";
import { productsForScope, scopeFromArgs } from "./workspaces.mjs";

// SPEC: This internal build is deliberately Rust-free for check/check:vscode.
// The client prepares both shared engines once; product scripts compile only themselves.
export function buildJavaScript(scope = "all") {
  const products = productsForScope(scope);
  console.log(`[build:js] scope: ${scope}`);
  run("pnpm", ["--filter", "@frostime/pi-client", "build"]);
  for (const product of products) {
    const directory = resolve(root, product.directory);
    console.log(`[build:js] compiling ${product.packageName}`);
    run(process.execPath, ["build.mjs"], { cwd: directory });
    for (const output of product.outputs) {
      const path = resolve(directory, output);
      if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing build output: ${path}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildJavaScript(scopeFromArgs(process.argv.slice(2)));
}
