# R1 同步 main：结果与验证

本轮完成用户要求的“开发分支和实际 worktree 跟上 main”。没有开始 Desktop 或 M1；主目录仍使用 main，产品代码没有反向合入 main。

## 基线与提交

- 同步的 main：`2ed69c1`，已发布版本 `0.15.5`；同步前重构候选为 `efa9c78`。
- 顶层先通过 `14c774c` 合入 main，随后 `385c7f1` 记录持续同步规则。
- 实现同步 checkpoint：`798ff05`，保留两侧历史并解决冲突，没有 rebase 或改写已审阅提交。
- E2E 启动器收尾：`a314714`；规划同步：`242bbab`。
- 已验证代码快照为 `242bbab`。后续结果/计划文档提交不改变该生产实现；实际候选位置始终为 `.worktrees/261011_desktop-host-boundary`、`refactor/desktop-host-boundary`。

旧 `efa9c78` 和先前的 575 项结果仍在 Git 历史中，但不作为最新 main 的候选或本轮验证依据。

## 合并内容

保留 main 的 0.15.5、Bridge 3.3、Provider usage、Pi 记录的工具时长、发布预算和干净检出检查修复，同时保留 pi-client 的 core/shared 提取和宿主输入边界。

- 工具时长的两个 projection 实现与 toolCallModel 逐文件对比 main 内容一致，只有存放位置变化；相关测试迁入客户端。
- Provider usage 新增 Dispatcher 和测试中的旧路径导入改到共享包；保持取消、关联、代理和凭据来源的 main 行为，不重写查询功能。
- 根 build/check/clean 同时编排 RPC、provider-usage、pi-client 与插件；Vite/TypeScript 保留两侧源码入口，lockfile 仅增加客户端 workspace 依赖，无第三方版本漂移。
- 共享 bridge 需要 Provider usage 的安全数据类型。将这些既有定义集中到 provider 包的纯 `types` 子入口，原入口保留兼容 type re-export；查询、凭据和 HTTP 运行逻辑不变。pi-client 显式声明依赖，shared 继续在无 Node/DOM globals 下检查，没有放宽隔离。

行尾规范化消除了一处非语义冲突。其余冲突按双方职责合并，不整份采用 ours/theirs；没有恢复第二份旧 shared/core 目录。

## 验证

日志在实施 worktree 的 Git-ignored `tmp/main-sync-*` 中。本轮使用隔离 Pi agent 目录、受控 fake Pi 和合成 provider 数据，没有查询真实账户或运行真实用户 Pi 会话。

| 检查 | 结果 | 证据 |
|---|---|---|
| frozen offline install | 0，lockfile 一致 | `main-sync-frozen-install.log/.exit` |
| provider/client/plugin typecheck | 全部 0；包含 shared 无 Node/DOM 检查 | `main-sync-typecheck-*.log/.exit` |
| 相关局部测试 | client 53 项、plugin 58 项通过 | `main-sync-core-tests.log/.exit`、`main-sync-plugin-tests.log/.exit` |
| 完整 `pnpm check` | 0；117 个文件、784 项：RPC 43、provider 162、client 165、plugin 414；lint/typecheck/build/预算通过 | `main-sync-check.log/.exit` |
| `package:vsix` / `verify:vsix` | 均 0；`artifacts/FrostPi-0.15.5.vsix`，78 entries、2.64 MB | `main-sync-package.log/.exit`、`main-sync-verify-vsix.log/.exit` |
| E2E 启动器 lint | 0 | `main-sync-e2e-launcher-lint.log/.exit` |
| 标准 `test:e2e` | 0；VS Code 1.142.0、fake Pi，非真实 Pi | `main-sync-e2e-final.log/.exit` |

完整检查和 VSIX 覆盖 `798ff05` 的生产同步代码；之后只追加测试启动器与文档。启动器有独立 lint 和标准 E2E 验证，不把旧完整检查说成后续每个文档提交都重跑过。

## E2E 排查及收尾

首次长任务在外层执行预算到期时没有留下完整 E2E 退出码，不能计为通过。原启动器使用仓库内 fixture；实际工作目录发现 3 个同仓库 worktree，自动 New Session 会遇到原生目录选择交互。

最小探针保持相同开发扩展、suite 与 VS Code，改用仓库外临时 fixture 后完成测试并退出 0。已停止确认属于本轮测试的旧窗口进程，不操作正常 VS Code 或用户 Pi。

因此测试启动器改为创建临时 workspace、复制合成 fixture，并在 finally 清理。标准 E2E 命令重新运行并捕获退出 0，不再仅依赖探针。没有修改 Registry 的工作目录选择或其他产品行为。

环境仍需在 E2E 命令中清除继承的 `ELECTRON_RUN_AS_NODE`。Svelte 的既有 tabindex warning、Vite chunk warning、Node deprecation 和测试版 VS Code 资源/服务警告不作为功能成功证据；实际断言和退出码为准。

## 持续同步与用户检查点

阶段开工、交付和用户实测前，执行顶层计划中的两个 main 祖先检查。main 更新后，不能只同步规划分支，实际 refactor 分支和 worktree 也必须同步、修正接线并重新验证。此规则不意味着自动反向合入 main 或自动处理所有未来冲突。

用户入口不变：在 VS Code 新窗口打开实施 worktree 根，F5 选择 `Run FrostPi Extension`，在 Development Host 中使用真实 Pi 检查新建/恢复、流式结果、Stop、会话切换与常用功能；本轮额外关注 Provider usage 和工具时长。

真实用户 Pi/历史、远程与其他平台尚未由本轮自动化验证。等用户确认后才讨论下一阶段；不自动安装候选 VSIX，不推送、不发布、不继续 UI/Bridge/Desktop。
