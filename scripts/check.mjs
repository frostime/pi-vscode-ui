import { runQuality } from "./quality.mjs";
import { run } from "./lib.mjs";
import { scopeFromArgs } from "./workspaces.mjs";

const scope = scopeFromArgs(process.argv.slice(2), ["all", "vscode"]);
console.log(`[check] scope: ${scope === "vscode" ? "shared + VS Code" : "all products"}`);
console.log("[check] version policy");
run(process.execPath, ["scripts/version.mjs", "check"]);
for (const target of ["lint", "typecheck", "test"]) {
  console.log(`[check] ${target}`);
  runQuality(target, { scope });
}
console.log("[check] build");
run(process.execPath, ["scripts/build.mjs", "--scope", scope]);
console.log("[check] bundle size");
run(process.execPath, ["scripts/check-bundle-size.mjs"]);
console.log("[check] complete");
