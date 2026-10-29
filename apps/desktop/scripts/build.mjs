import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { buildJavaScript } from "../../../scripts/build.mjs";
import { assertNoArguments, run } from "../../../scripts/lib.mjs";
import { copyRuntimeFiles, desktopRoot } from "./packaging.mjs";

assertNoArguments("pnpm build:desktop");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Desktop builds support Windows x64 only.");

buildJavaScript("desktop");
console.log("[build:desktop] compiling Rust executable");
run("pnpm", ["exec", "tauri", "build", "--no-bundle", "--", "--locked"], { cwd: desktopRoot });
const releaseDirectory = resolve(desktopRoot, "src-tauri/target/release");
const executable = resolve(releaseDirectory, "frostpi-desktop.exe");
if (!existsSync(executable) || statSync(executable).size === 0) throw new Error(`Missing Desktop executable: ${executable}`);
copyRuntimeFiles(releaseDirectory);
console.log(`Built ${executable} with current backend and Pi extensions`);
