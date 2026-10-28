import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { desktopRoot, distributedArchive } from "./packaging.mjs";
import { sha256, verifyArchive } from "./archive-contract.mjs";
import { configuredGuiPath, findOnPath } from "./windows-gui-path.mjs";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Tauri verification supports Windows x64 only.");
const args = process.argv.slice(2);
assert.ok(args.every((arg) => !arg.startsWith("--") || ["--real-pi", "--native-dialogs"].includes(arg)), "Unknown Desktop verification option");
const archive = resolve(args.find((arg) => !arg.startsWith("--")) ?? distributedArchive());
const report = `${archive}.verification.json`;
const result = {
  ok: false, archive, verifiedAt: new Date().toISOString(),
  checks: {
    archive: "not-run", smoke: "not-run",
    realPi: args.includes("--real-pi") ? "unverified" : "not-requested",
    nativeDialogs: args.includes("--native-dialogs") ? "unverified" : "not-requested",
  },
};
try {
  const bytes = readFileSync(archive);
  result.sha256 = sha256(bytes);
  result.archiveBytes = bytes.length;
  result.checks.archive = "failed";
  const zip = new AdmZip(bytes);
  result.buildInfo = verifyArchive(zip);
  result.checks.archive = "passed";
  const directory = mkdtempSync(join(tmpdir(), "frostpi-tauri-verify-"));
  result.directory = directory;
  zip.extractAllTo(directory, false);
  const guiPath = configuredGuiPath();
  assert.ok(findOnPath(guiPath.value, "node"), "Node is unavailable on the configured Windows desktop PATH");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  environment.Path = guiPath.value;
  result.checks.smoke = "failed";
  const child = spawn(process.execPath, [resolve(desktopRoot, "scripts/smoke.mjs"), join(directory, "FrostPi/FrostPi.exe"), ...args.filter((arg) => arg.startsWith("--"))], {
    cwd: desktopRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment,
  });
  const stdout = []; const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => {
    // This runner owns the exact PID; timeout cleanup must include its native child.
    if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10000 });
  }, 240000);
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); }).finally(() => clearTimeout(timer));
  const output = Buffer.concat(stdout).toString(); const errors = Buffer.concat(stderr).toString();
  if (output) process.stdout.write(output); if (errors) process.stderr.write(errors);
  let smoke;
  try { smoke = JSON.parse(output.trim().split(/\r?\n/).at(-1)); } catch { /* No success artifact means failure. */ }
  result.smoke = smoke;
  assert.ok(code === 0 && smoke?.ok === true, "Packaged Desktop smoke did not report success");
  result.checks.smoke = "passed";
  if (args.includes("--real-pi")) result.checks.realPi = "passed";
  if (args.includes("--native-dialogs")) result.checks.nativeDialogs = "passed";
  result.ok = true;
} catch (error) {
  result.error = String(error);
  console.error(result.error);
} finally {
  writeFileSync(report, JSON.stringify(result, null, 2) + "\n");
  if (result.directory) writeFileSync(join(result.directory, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`Tauri verification: ${report}`);
}
process.exitCode = result.ok ? 0 : 1;
