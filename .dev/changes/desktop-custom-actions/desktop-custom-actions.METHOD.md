# 实现与验证记录

## 当前实现

`apps/desktop/src/shared/desktopActions.ts` 定义用户命令、设置 schema 和 PowerShell 路径参数展开。`desktop.actions` 是一个数组；省略 `projectId` 为全局，否则绑定 Desktop Project id。`ProjectActions` 读取当前已保存设置，投影不含命令的菜单元数据，并在执行时重新检查动作身份和项目归属。后台始终用被点击项目的 cwd，renderer 不能传路径或临时命令。

终端路径在启动时从 PATH 解析。Windows Terminal 使用 `-w new new-tab` 启动 Windows PowerShell，`-NoExit` 保留窗口。目录设置和命令一起以 UTF-16LE Base64 传给 `-EncodedCommand`，避开 Windows Terminal 对分号的解析。PowerShell 路径引用同时转义 ASCII 与 U+2018–U+201B 单引号；变量展开使用 JS replacement callback，保留路径中的 JavaScript dollar replacement tokens。这些是独立审查发现、真实解析器实验确认的问题，不得退回普通 replacement string 或只转义 ASCII 引号。

Settings 仍拥有完整草稿、保存、丢弃与关闭确认；`ActionSettings.svelte` 只编辑数组。配置范围与导航项目分离，默认全局，项目必须显式选择。变更摘要只显示动作数量，不打印命令。侧栏与主面板菜单共用组件但显示不同内容。

## 已有证据与剩余整合

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
