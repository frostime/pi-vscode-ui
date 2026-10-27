import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { desktopNoticesText } from "./desktop-notices.mjs";
import { artifactsRoot, buildOutput, productVersion, repositoryRoot } from "./packaging.mjs";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Tauri packaging supports Windows x64 only.");
const executable = resolve("src-tauri/target/release/frostpi-desktop.exe");
for (const file of [executable, join(buildOutput, "backend.cjs"), join(buildOutput, "pi-extensions/session-tree.js"), join(buildOutput, "pi-extensions/question-tool.js")]) {
  if (!existsSync(file)) throw new Error(`Missing build output: ${file}`);
}
function removeStage(stage) {
  const canonical = realpathSync(stage);
  if (!canonical.startsWith(realpathSync(tmpdir()) + sep) || !basename(canonical).startsWith("frostpi-tauri-package-")) throw new Error("Refusing to remove an unexpected staging path.");
  rmSync(canonical, { recursive: true, force: true });
}
const stage = mkdtempSync(join(tmpdir(), "frostpi-tauri-package-"));
const root = join(stage, "FrostPi"); mkdirSync(root);
try {
  cpSync(executable, join(root, "FrostPi.exe"));
  cpSync(join(buildOutput, "backend.cjs"), join(root, "backend.cjs"));
  mkdirSync(join(root, "pi-extensions"));
  for (const name of ["session-tree.js", "question-tool.js"]) cpSync(join(buildOutput, "pi-extensions", name), join(root, "pi-extensions", name));
  // Pi extension artifacts use ESM; backend.cjs remains explicitly CommonJS.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "frostpi-desktop", private: true, type: "module", version: productVersion() }) + "\n");
  cpSync(join(repositoryRoot, "LICENSE"), join(root, "LICENSE"));
  writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), desktopNoticesText());
  // Cargo.lock is the complete native dependency inventory for this local research candidate.
  cpSync(resolve("src-tauri/Cargo.lock"), join(root, "Cargo.lock"));
  writeFileSync(join(root, "README.txt"), `FrostPi Desktop ${productVersion()} - Tauri Windows x64 research candidate\n\nExtract the entire folder and run FrostPi.exe.\nRequires Node.js 22.19+, Pi and Microsoft Edge WebView2 Runtime on the desktop PATH.\nThis package does not include Electron, Node, Pi, or WebView2.\nProfiles remain under %APPDATA%\\FrostPi. Use FROSTPI_DESKTOP_USER_DATA for isolation.\nThis unsigned candidate is for migration validation, not a verified replacement for the Electron distribution.\nMessages larger than 32 MiB are rejected; reduce attachments or select a smaller session. Full native interaction parity remains under validation. No automatic updates.\nLicense: AGPL-3.0-only. Source: https://github.com/frostime/pi-vscode-ui\n`);
  const archive = new AdmZip(); archive.addLocalFolder(root, "FrostPi");
  mkdirSync(artifactsRoot, { recursive: true });
  const target = join(artifactsRoot, `FrostPi-${productVersion()}-tauri-win32-x64.zip`);
  const temporary = `${target}.tmp`;
  try { archive.writeZip(temporary); rmSync(target, { force: true }); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
  const size = readFileSync(target).length;
  console.log(`Tauri research candidate: ${target} (${size} bytes)`);
} finally { removeStage(stage); }
