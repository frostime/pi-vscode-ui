import { assertNoArguments, run } from "./lib.mjs";
import { packagesForScope } from "./workspaces.mjs";

assertNoArguments("pnpm clean");
for (const packageName of packagesForScope()) {
  run("pnpm", ["--filter", packageName, "clean"]);
}
run(process.execPath, ["scripts/clean-dir.mjs", "artifacts"]);
