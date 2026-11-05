# 实现与验证记录

## 当前实现

`apps/desktop/src/shared/desktopActions.ts` 定义用户命令、设置 schema 和 PowerShell 路径参数展开。`desktop.actions` 是一个数组；省略 `projectId` 为全局，否则绑定 Desktop Project id。`ProjectActions` 读取当前已保存设置，投影不含命令的菜单元数据，并在执行时重新检查动作身份和项目归属。后台始终用被点击项目的 cwd，renderer 不能传路径或临时命令。

终端与 shell 路径在启动时从 PATH 独立解析。shell 优先 `pwsh.exe`，其次 `powershell.exe`。存在 Windows Terminal 时使用 `-w FrostPi new-tab`，由 WT 创建或复用专用命名窗口；没有 WT 时由原生宿主直接启动 shell，窗口宿主交给 Windows。`-NoExit` 保留 shell。选择只依据可用性，不在启动或命令失败后重跑。目录设置和命令一起以 UTF-16LE Base64 传给 `-EncodedCommand`，避开 Windows Terminal 对分号的解析。PowerShell 路径引用同时转义 ASCII 与 U+2018–U+201B 单引号；变量展开使用 JS replacement callback，保留路径中的 JavaScript dollar replacement tokens。这些是独立审查发现、真实解析器实验确认的问题，不得退回普通 replacement string 或只转义 ASCII 引号。

Settings 仍拥有完整草稿、保存、丢弃与关闭确认；`ActionSettings.svelte` 只编辑数组。配置范围与导航项目分离，默认全局，项目必须显式选择。变更摘要只显示动作数量，不打印命令。侧栏与主面板菜单共用组件但显示不同内容。

## 终端选择与命名窗口修订（基于 7750db1）

用户明确接受可选 WT、优先 pwsh、其次 Windows PowerShell，以及只复用 FrostPi 专用窗口，不混入最近使用的其他窗口。实现位于 `apps/desktop/src/main/projectActions.ts`；未增加设置项、进程跟踪、原生权限或 renderer 接口，Open In 各个具名工具菜单不变。相关回归测试在 `apps/desktop/test/terminalActions.test.ts`，正式 GUI smoke 会核验真实 shell 可执行文件名称及后台 WT 可用性。

- Desktop focused tests 41 passed，覆盖两级选择、重复启动目标窗口一致、lazygit 不依赖 WT、失败只启动一次及错误不泄漏命令。新增用例先在旧实现上运行，8 failed，确认能抓到旧行为。Desktop lint/typecheck 通过；仍只有既有共享组件的 a11y warning。
- `tmp/terminal-handoff-native-spike.mjs` 使用生产 ProjectActions 的参数发起两条并发 PowerShell 7 命令，枚举只匹配测试标题的原生窗口，确认二者在同一个 HWND。含弯单引号、中文、分号和 dollar replacement tokens 的 cwd/placeholder 均正确。结果为 `tmp/terminal-handoff-probe-XGJxsN/result.json`。该 spike 的启动适配器是 Start-Process，不把它单独视为 Rust/native 端到端证据。
- 完整 Desktop JS/Rust 构建通过。测试 exe SHA-256 为 `0dab9f19c9c9dd3ba242d43f73e39755bee99fc2c2b35ae13cb106be5855fd34`；构建时为 7750db1 加本修订工作树，之后仅调整了源码注释、测试描述和文档，不是干净提交构建。
- `tmp/terminal-handoff-smoke-matrix.mjs` 在子进程 PATH 中分别保留全部工具、移除 WT、移除 WT 与 pwsh，不修改系统环境。三轮真实 renderer → backend → Rust → shell GUI smoke 均为 17 checks passed，分别验证 WT/pwsh、直接 pwsh、直接 powershell；同时核验真实执行程序名称和项目 cwd。
- 三轮结果分别在 `C:/Users/EEG/AppData/Local/Temp/frostpi-tauri-smoke-pe4PtA/result.json`、`frostpi-tauri-smoke-4wpK05/result.json`、`frostpi-tauri-smoke-o30tO0/result.json`（后两项同属该 Temp 目录）。初轮在 Actions 之前的既有窗口自动化阶段遇到 `spawnSync powershell ETIMEDOUT`，未更改产品或超时机制；完整复跑三轮通过。初轮失败记录仍在 `frostpi-tauri-smoke-Co0PIn/result.json`。
- 没有重跑与此 Desktop-only 改动无关的整个 workspace gate；下节记录的链接环境限制仍适用，不能据 focused/native 通过声称全量 gate 通过。

## 初次整合验证（49d62a1 产品代码）

- focused Desktop backend/settings tests：35 passed；Desktop typecheck：0 errors（有既有共享组件 a11y warning）。
- `apps/vscode/test/unit/desktopActions.dom.test.ts`：6 passed，覆盖真实 SettingsPanel/DesktopShell 组合和草稿行为。
- `tmp/desktop-actions-spike.mjs` 通过真实 Windows Terminal 执行生产 ProjectActions 生成的启动参数；目录含中文、普通/弯单引号、分号与 JS replacement tokens，cwd 和 `{{cwd}}` 内容一致。
- `tmp/powershell-path-quote-spike.mjs` 证明旧单引号算法不能处理智能引号，新算法在 Windows PowerShell 实际解析器中保留原值。
- 两项功能已在 `quasi-main` 整合：Actions feature commit `6591ca4`，文件链接远端 commit `5d2d032`；产品代码整合点 `49d62a1`。main 保持 `3ec12d2`，未推送远端。
- 整合后的全仓 lint、所有产品 typecheck、两产品 JS build、VS Code bundle budgets 和 Desktop JS/Rust 完整构建通过。Svelte 有一个既有共享组件 a11y warning。
- 最终 Desktop GUI smoke 完整通过 17 项：包括真实 renderer → backend → Rust → 外部终端写 cwd 验证文件、显式项目配置与草稿、并行会话、tray、恢复和受控崩溃。结果在 `C:/Users/EEG/AppData/Local/Temp/frostpi-tauri-smoke-2snHVJ/result.json`；exe SHA-256 为 `35d532f3c2c3d6afa5ebb58e30ca19cf2eeedaacae1c7e0037448750b3daa59d`。这次构建已包含两处路径转义修复。
- 文件链接分支独立静态审查无实质发现。整合后 shared fallback tests 5/5、VS Code file routing 7/7 通过；Desktop file links 28/29 通过，剩下一个是既有 symlink target fixture 的本机环境失败。真实 fd 查找和 HTML/SVG 默认应用关联未做原生专项 smoke。
- 全 workspace package tests：1074 passed、14 failed。失败均依赖本机不能读取的 symlink/junction/alias fixtures，未改测试以掩盖它们。`pnpm check` 的 lint/typecheck 阶段通过，但在工程脚本的临时 node_modules junction 测试处失败，因此不能声称完整 gate 通过；被它阻断的 package tests、build 和 bundle budgets 已分别运行并记录结果。

## 本机验证环境限制

本机对 H: 工作区和 C: 临时目录中的文件符号链接、目录符号链接与 junction 均无法正常读取。独立最小实验以及原有 Desktop alias tests 都可复现；不能通过删改产品测试掩盖该问题。常规 pnpm isolated layout 因此不可用，原 node_modules 已移动到被 Git 忽略的 `tmp/dependency-backup/`，没有删除。

当前依赖使用 root hoisted/copy layout；六个 workspace junction 由忽略目录中的真实副本代替。`tmp/sync-workspace-dependencies.mjs` 同步这些副本；共享包重新构建或合入远端共享代码后，须再运行它，避免测试引用旧 dist。没有改 `.npmrc`、lockfile 或产品依赖声明。不要再次直接运行普通 pnpm install 恢复坏链接。

Desktop 起始 suite 在 Actions 改动下有 200 passed、7 failed；当时 7 个失败涉及的测试文件和产品模块均未改，且独立链接探针失败。最终合入文件路由后为 206 passed、7 failed，仍为同组链接相关 fixtures。共享 Session alias/worktree 和 VS Code workspace alias fixtures 也以相同方式失败。不能将这些失败标为通过，也不能把它们归因到本轮新功能。

## 0.16.4 本地测试 MSI（非发布）

版本由 `pnpm version:set 0.16.4` 写入 `apps/vscode/package.json`，CHANGELOG 的 `Unreleased` 条目移入 `[0.16.4] - 2026-11-05`。这些改动已在 quasi-main；main 仍为 0.16.3。

本机没有 `FROSTPI_UPDATE_PUBLIC_KEY`、`TAURI_SIGNING_PRIVATE_KEY`，正式 `package:desktop:msi` 因此不可用。用户明确同意产物为**不启用自动更新的本地测试 MSI**：不创建密钥、不签名、不生成 `.sig` 或更新 manifest，也不改正式打包脚本。临时脚本 `tmp/package-local-test-msi.mjs` 复用正式构建输出与安装清单，但关闭 `createUpdaterArtifacts`，并保留 `tauri.conf.json` 的空 pubkey。该脚本与产物不可作为发布资产。

- 产物 `artifacts/FrostPi-0.16.4-win32-x64-local-test.msi`，7,589,888 bytes，SHA-256 `c0917d8141aec740b58a1540e513ac6987252ebea89903215435a923bab445a1`。
- MSI 属性：ProductName `FrostPi`、ProductVersion `0.16.4`、ALLUSERS=1（全用户安装，需要 UAC）、UpgradeCode 与正式安装一致；因此会升级本机已有的 0.16.3 安装（`G:\Apps\FrostPi`），不是并存。
- 管理员解包核对载荷：exe FileVersion/ProductVersion `0.16.4`，backend.cjs、pi-extensions、LICENSE、Cargo.lock、package.json 均在预期目录；exe 未签名（预期）。
- 本机 hoisted 依赖缺少若干包内 LICENSE 文件，正式 notices 生成失败，因此本地 MSI 未含 THIRD_PARTY_NOTICES.md 与 NATIVE_NOTICES.md。这只是本地测试产物；发布包必须走正式流程生成 notices。
- 对解包后的真实载荷运行 Desktop GUI smoke，17 checks 通过，包括真实终端 Action、`updates({type:'read'})` 报告版本等于产品版本，以及 Settings 内 Updates 不发起网络检查。首次在该载荷上的 smoke 在既有 tray 恢复自动化处超时，重跑通过；未改产品代码。
- 未验证：实际安装/UAC 升级/卸载、Authenticode 信任提示、正式签名与更新链路。安装后的运行效果需用户本地确认。
