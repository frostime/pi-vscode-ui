import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [".", ...process.argv.slice(2)], { stdio: "inherit", env: environment });
child.on("error", () => { console.error("Could not launch Electron."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
