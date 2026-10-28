import { pathToFileURL } from "node:url";

import { run } from "./lib.mjs";

const targets = new Set(["lint", "typecheck", "test"]);
const packageNames = ["@frostime/pi-rpc", "@frostime/provider-usage", "@frostime/pi-client", "frostpi", "@frostime/frostpi-desktop"];

export function runQuality(target, { vscodeOnly = false } = {}) {
  if (!target || !targets.has(target)) {
    throw new Error(`Unknown quality target: ${target ?? ""}`);
  }
  for (const packageName of packageNames) {
    if (vscodeOnly && packageName === "@frostime/frostpi-desktop") continue;
    run("pnpm", ["--filter", packageName, target]);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const target = process.argv[2];
  if (!target || !targets.has(target)) {
    throw new Error(`Usage: node scripts/quality.mjs <${[...targets].join("|")}>`);
  }
  runQuality(target);
}
