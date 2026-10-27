import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { nativeNoticesText } from "./native-notices.mjs";
import { desktopNoticesText } from "./desktop-notices.mjs";
import { artifactsRoot, buildOutput, distributedArchive, productVersion, repositoryRoot } from "./packaging.mjs";

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
  writeFileSync(join(root, "NATIVE_NOTICES.md"), nativeNoticesText());
  // Keep the exact native versions alongside their source and license notices.
  cpSync(resolve("src-tauri/Cargo.lock"), join(root, "Cargo.lock"));
  writeFileSync(join(root, "README.txt"), `FrostPi Desktop ${productVersion()} - Windows x64

将 FrostPi 文件夹完整解压，双击 FrostPi.exe 启动。
需要自行安装 Node.js 22.19+、Pi 命令行和 Microsoft Edge WebView2 Runtime。
从资源管理器启动时的 PATH 必须能找到 Node 和 Pi；本包不捆绑这些运行时。

设置与项目/会话索引保存在 %APPDATA%\\FrostPi；FROSTPI_DESKTOP_USER_DATA 可指定隔离目录。
正常关闭会停止 Pi 子进程并保存索引；草稿和进行中的回答不会恢复。
单条消息的 UTF-8 JSON 上限为 32 MiB。超限时请减少附件，或选择其他/新建会话。

本包为未签名的 Windows x64 免安装版，不含自动更新。
许可证：AGPL-3.0-only，见同目录 LICENSE。
第三方归属见 THIRD_PARTY_NOTICES.md、NATIVE_NOTICES.md 和 Cargo.lock。
源码：https://github.com/frostime/pi-vscode-ui
`);
  const archive = new AdmZip(); archive.addLocalFolder(root, "FrostPi");
  mkdirSync(artifactsRoot, { recursive: true });
  const target = distributedArchive();
  const temporary = `${target}.tmp`;
  try { archive.writeZip(temporary); rmSync(target, { force: true }); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
  const size = readFileSync(target).length;
  console.log(`Packaged Windows Desktop: ${target} (${size} bytes)`);
} finally { removeStage(stage); }
