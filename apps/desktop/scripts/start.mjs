import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { developmentLaunchEnvironment } from "./development-profile.mjs";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Tauri Desktop currently supports Windows x64 only.");
const executable = resolve("src-tauri/target/release/frostpi-desktop.exe");
if (!existsSync(executable)) throw new Error("Run pnpm build:desktop first.");
// Detached keeps the app out of this console group: a launcher Ctrl+C must not hard-kill
// Desktop and skip its exit cleanup. Stop the app from its tray Exit menu instead.
const child = spawn(executable, process.argv.slice(2), { stdio: "ignore", detached: true, env: developmentLaunchEnvironment(process.env) });
child.unref();
child.once("error", () => { console.error("Could not start FrostPi Desktop."); process.exitCode = 1; });
console.log("FrostPi Desktop launched with the development profile; the launcher returns immediately.");
