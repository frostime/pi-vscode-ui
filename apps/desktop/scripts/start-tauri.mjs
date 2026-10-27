import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Tauri Desktop currently supports Windows x64 only.");
const executable = resolve("src-tauri/target/release/frostpi-desktop.exe");
if (!existsSync(executable)) throw new Error("Run pnpm --dir apps/desktop build:tauri first.");
const child = spawn(executable, process.argv.slice(2), { stdio: "inherit", windowsHide: true });
child.once("error", () => { console.error("Could not start FrostPi Desktop."); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
