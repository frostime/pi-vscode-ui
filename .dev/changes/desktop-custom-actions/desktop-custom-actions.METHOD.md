# 实现与验证记录

## 当前实现

`apps/desktop/src/shared/desktopActions.ts` 定义用户命令、设置 schema 和 PowerShell 路径参数展开。`desktop.actions` 是一个数组；省略 `projectId` 为全局，否则绑定 Desktop Project id。`ProjectActions` 读取当前已保存设置，投影不含命令的菜单元数据，并在执行时重新检查动作身份和项目归属。后台始终用被点击项目的 cwd，renderer 不能传路径或临时命令。

终端路径在启动时从 PATH 解析。Windows Terminal 使用 `-w new new-tab` 启动 Windows PowerShell，`-NoExit` 保留窗口。目录设置和命令一起以 UTF-16LE Base64 传给 `-EncodedCommand`，避开 Windows Terminal 对分号的解析。PowerShell 路径引用同时转义 ASCII 与 U+2018–U+201B 单引号；变量展开使用 JS replacement callback，保留路径中的 `$&`、`$$`、`$\`` 和 `$'`。这些是独立审查发现、真实解析器实验确认的问题，不得退回普通 replacement string 或只转义 ASCII 引号。

Settings 仍拥有完整草稿、保存、丢弃与关闭确认；`ActionSettings.svelte` 只编辑数组。配置范围与导航项目分离，默认全局，项目必须显式选择。变更摘要只显示动作数量，不打印命令。侧栏与主面板菜单共用组件但显示不同内容。

## 已有证据与剩余整合

- focused Desktop backend/settings tests：35 passed；Desktop typecheck：0 errors（有既有共享组件 a11y warning）。
- `apps/vscode/test/unit/desktopActions.dom.test.ts`：6 passed，覆盖真实 SettingsPanel/DesktopShell 组合和草稿行为。
- `tmp/desktop-actions-spike.mjs` 通过真实 Windows Terminal 执行生产 ProjectActions 生成的启动参数；目录含中文、普通/弯单引号、分号与 JS replacement tokens，cwd 和 `{{cwd}}` 内容一致。
- `tmp/powershell-path-quote-spike.mjs` 证明旧单引号算法不能处理智能引号，新算法在 Windows PowerShell 实际解析器中保留原值。
- 扩展的 Desktop GUI smoke 已完整通过一次，包含真实 renderer → backend → Rust → 外部终端写 cwd 验证文件，以及并行会话、草稿、tray、恢复和受控崩溃。其后审查发现的路径转义修复仍须随整合后重新构建/复验。
- `origin/feat/desktop-file-link-routing` 的 `5d2d032` 已独立静态审查，无实质发现；整合后需运行其 focused tests。
- 最后需完成 lint/全量 gate、任务分支 squash、两个功能合入 quasi-main，以及整合后的构建/验证。不能合入 main。

## 本机验证环境限制

本机对 H: 工作区和 C: 临时目录中的文件符号链接、目录符号链接与 junction 均无法正常读取。独立最小实验以及原有 Desktop alias tests 都可复现；不能通过删改产品测试掩盖该问题。常规 pnpm isolated layout 因此不可用，原 node_modules 已移动到被 Git 忽略的 `tmp/dependency-backup/`，没有删除。

当前依赖使用 root hoisted/copy layout；六个 workspace junction 由忽略目录中的真实副本代替。`tmp/sync-workspace-dependencies.mjs` 同步这些副本；共享包重新构建或合入远端共享代码后，须再运行它，避免测试引用旧 dist。没有改 `.npmrc`、lockfile 或产品依赖声明。不要再次直接运行普通 pnpm install 恢复坏链接。

Desktop 全量 suite 起始运行有 200 passed、7 failed；7 个失败均涉及原有 symlink/junction fixtures（包括 packaging 临时 node_modules junction）。这些测试文件和对应产品模块当时未改，不能将其标为通过。全量 gate 若仍被同一环境问题阻塞，最终应明确报告，不阻止有证据的 scoped/native 验证。
