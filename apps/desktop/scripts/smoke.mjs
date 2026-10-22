import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), "frostpi-desktop-smoke-"));
for (const name of ["project-a", "project-b", "electron-profile", "pi-agent"]) mkdirSync(join(directory, name));
await build({ entryPoints: ["test/smokeMain.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: "dist/smoke-main.cjs", external: ["electron"] });
const environment = {
  ...process.env,
  FROSTPI_DESKTOP_SMOKE_DIR: directory,
  FROSTPI_DESKTOP_SMOKE_PI: resolve("../pi-client/test/fixtures/fake-pi.cjs"),
  PI_CODING_AGENT_DIR: join(directory, "pi-agent"),
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [resolve("scripts/smoke-bootstrap.cjs"), resolve("dist/smoke-main.cjs")], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
const logs = [];
child.stdout.on("data", (chunk) => logs.push(chunk));
child.stderr.on("data", (chunk) => logs.push(chunk));
const timeout = setTimeout(() => child.kill(), 90_000);
const code = await new Promise((resolveExit) => {
  child.once("error", () => resolveExit(1));
  child.once("exit", (value) => resolveExit(value ?? 1));
});
clearTimeout(timeout);
writeFileSync(join(directory, "electron.log"), Buffer.concat(logs));
console.log(`Desktop smoke artifacts: ${directory}`);
let passed = false;
try {
  const result = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
  passed = result.ok === true;
  console.log(JSON.stringify(result));
} catch { console.error("Desktop smoke did not produce a result."); }
process.exitCode = passed && code === 0 ? 0 : 1;
