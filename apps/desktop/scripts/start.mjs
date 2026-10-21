import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");
const directory = mkdtempSync(join(tmpdir(), "frostpi-desktop-preview-"));
const environment = { ...process.env, FROSTPI_DESKTOP_PREVIEW_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env: environment });
child.on("error", () => { console.error("Could not launch Electron."); process.exitCode = 1; });
child.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  process.exitCode = code ?? 1;
});
