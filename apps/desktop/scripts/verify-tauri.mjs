import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { artifactsRoot, productVersion } from "./packaging.mjs";
import { configuredGuiPath, findOnPath } from "./windows-gui-path.mjs";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Tauri verification supports Windows x64 only.");
const archive = resolve(process.argv[2] ?? join(artifactsRoot, `FrostPi-${productVersion()}-tauri-win32-x64.zip`));
const bytes = readFileSync(archive); const zip = new AdmZip(bytes);
const allowed = new Set(["FrostPi/FrostPi.exe", "FrostPi/backend.cjs", "FrostPi/package.json", "FrostPi/LICENSE", "FrostPi/THIRD_PARTY_NOTICES.md", "FrostPi/README.txt", "FrostPi/Cargo.lock", "FrostPi/pi-extensions/session-tree.js", "FrostPi/pi-extensions/question-tool.js"]);
for (const entry of zip.getEntries()) {
  assert.ok(entry.isDirectory ? ["FrostPi/", "FrostPi/pi-extensions/"].includes(entry.entryName) : allowed.delete(entry.entryName), `Unexpected/duplicate archive entry: ${entry.entryName}`);
}
assert.equal(allowed.size, 0, "Incomplete Tauri archive");
const directory = mkdtempSync(join(tmpdir(), "frostpi-tauri-verify-"));
zip.extractAllTo(directory, false);
const guiPath = configuredGuiPath();
assert.ok(findOnPath(guiPath.value, "node"), "Node is unavailable on the configured Windows desktop PATH");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
environment.Path = guiPath.value;
const child = spawn(process.execPath, [resolve("scripts/smoke-tauri.mjs"), join(directory, "FrostPi/FrostPi.exe")], {
  cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment,
});
const stdout = []; const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
const timer = setTimeout(() => child.kill(), 120000);
const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); }).finally(() => clearTimeout(timer));
const output = Buffer.concat(stdout).toString(); const errors = Buffer.concat(stderr).toString();
if (output) process.stdout.write(output); if (errors) process.stderr.write(errors);
let smoke;
try { smoke = JSON.parse(output.trim().split(/\r?\n/).at(-1)); } catch { /* No success artifact means failure. */ }
const result = { ok: code === 0 && smoke?.ok === true, archive, sha256: createHash("sha256").update(bytes).digest("hex"), archiveBytes: bytes.length, directory, smoke };
writeFileSync(join(directory, "verification.json"), JSON.stringify(result, null, 2));
console.log(`Tauri verification: ${join(directory, "verification.json")}`);
process.exitCode = result.ok ? 0 : 1;
