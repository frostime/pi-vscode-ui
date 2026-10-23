import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Packaging constants shared by the Desktop packager and its archive verification. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const desktopRoot = resolve(repositoryRoot, "apps/desktop");
export const buildOutput = resolve(desktopRoot, "dist");
export const artifactsRoot = resolve(repositoryRoot, "artifacts");
export const productName = "FrostPi";
export const targetPlatform = "win32";
export const targetArch = "x64";

const versionSource = resolve(repositoryRoot, "apps/vscode/package.json");

/** The product version keeps its single authority in the extension manifest. */
export function productVersion() {
  return JSON.parse(readFileSync(versionSource, "utf8")).version;
}

export function distributedArchive() {
  return resolve(artifactsRoot, `${productName}-${productVersion()}-${targetPlatform}-${targetArch}.zip`);
}

/** The already-verified local Electron installation used as the packaging input. */
export function electronInstallation() {
  const packageRoot = resolve(desktopRoot, "node_modules/electron");
  return {
    version: JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version,
    distribution: resolve(packageRoot, "dist"),
  };
}

/**
 * Everything the distributed app may contain, relative to `resources/app`.
 * Staging copies exactly these entries; verification rejects anything else.
 */
export const applicationPayload = {
  files: ["package.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "dist/main.cjs", "dist/preload.cjs"],
  directories: ["dist/renderer", "dist/pi-extensions"],
};

export function isAllowedPayloadPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return applicationPayload.files.includes(normalized)
    || applicationPayload.directories.some((directory) => normalized.startsWith(`${directory}/`));
}

/** Files that sit beside the executable instead of inside the application payload. */
export const distributionFiles = ["README.txt"];

/** The archive-root README is the only user-facing prose in the distribution. */
export function distributionReadme() {
  return `FrostPi Desktop ${productVersion()} - Windows x64 免安装版

如何启动
  1. 将压缩包完整解压到任意目录，并保留 FrostPi 文件夹结构。
  2. 双击 FrostPi.exe 启动；不需要源码仓库、pnpm 或开发用 Electron 启动器。

前置条件
  - 本机需自行安装 Node.js 与 Pi 命令行，并且从资源管理器或开始菜单启动时能找到它们。
  - 本包不捆绑 Node 或 Pi；找不到时应用会显示启动失败，可在设置中指向已安装的 Pi。

设置与数据
  - 首次启动可导入 VS Code 用户设置白名单，或直接使用默认值；之后在设置面板或会话菜单中修改。
  - 用户数据保存在 %APPDATA%\\FrostPi（settings.json、state.json 与会话文件都在该目录）。
  - 正常关闭窗口会停止 Pi 子进程并保存项目与会话索引；草稿和进行中的回答不会恢复。

版本与许可
  - 未签名的 Windows x64 开发候选版本，不含自动更新。
  - 源码：https://github.com/frostime/pi-vscode-ui
  - 许可证：AGPL-3.0-only，全文见 resources\\app\\LICENSE。
`;
}
