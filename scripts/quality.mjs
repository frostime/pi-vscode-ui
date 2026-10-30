import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertNoArguments, root, run } from "./lib.mjs";
import { packagesForScope } from "./workspaces.mjs";

const targets = new Set(["lint", "typecheck", "test"]);

export function runQuality(target, { scope = "all" } = {}) {
  if (!targets.has(target)) throw new Error(`Unknown quality target: ${target ?? ""}`);
  const packageNames = packagesForScope(scope);
  if (target === "lint") {
    run("pnpm", ["exec", "eslint", "scripts", "eslint.config.js", "--max-warnings", "0"]);
  } else if (target === "test") {
    run(process.execPath, ["--test"], { cwd: resolve(root, "scripts/test") });
  }
  for (const packageName of packageNames) {
    run("pnpm", ["--filter", packageName, target]);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const usage = `node scripts/quality.mjs <${[...targets].join("|")}>`;
  const [target, ...args] = process.argv.slice(2);
  assertNoArguments(usage, args);
  if (!targets.has(target)) throw new Error(`Usage: ${usage}`);
  runQuality(target);
}
