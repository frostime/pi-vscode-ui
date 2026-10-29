# 验证结果

验证对象为 `refactor/workspace-commands` 的本次实现，基线是合并准备分支后的 `5e4e879`。以下命令在提交前的代码工作区运行；之后仅整理 change 记录。环境为 Windows/MSYS、Node 24.12.0、pnpm 10.13.1。未实际覆盖其他操作系统或最低 Node 版本。

## 最终结果

| 命令/检查 | 结果 |
|---|---|
| `pnpm check` | 通过：17 项 Node 工程测试 + 1008 项 Vitest 测试；lint、类型、双端 JS 构建和扩展体积检查通过 |
| `pnpm check:vscode` | 默认命令重跑通过：17 项 Node 工程测试 + 836 项 Vitest 测试；日志无 Desktop 包执行 header |
| `pnpm build:vscode` | 通过，只构建共享依赖和扩展 |
| `pnpm build:desktop` | 通过，只构建共享依赖和 Desktop JS/renderer |
| `pnpm --dir apps/desktop build` | 通过：本地完整入口仍准备共享依赖，无扩展构建 |
| `pnpm package:vsix` | 通过：扩展及共享依赖完整重建，未构建 Desktop，生成 `artifacts/FrostPi-0.16.0.vsix` |
| `pnpm verify:vsix` | 通过：78 entries，2.65 MB |
| Desktop packaging 局部测试 | 18 项通过，包含两个新增的隔离参数拒绝用例 |
| 文档本地链接/锚点 | 13 个文件中的 68 个引用全部解析成功 |
| `git diff --check` | 通过 |

构建日志的 pnpm 脚本 header 确认：全量 build 阶段中，pi-client、pi-rpc、provider-usage 的 build 各执行一次，VS Code 和 Desktop 的 build:local 各执行一次。产品独立构建及 VSIX 打包中，每个共享依赖也只准备一次。

## 波动和证据限制

首次独立 `check:vscode` 在共享客户端 4 项测试上触发原有 5000ms 时限；随后默认单包复查在另一个 Git worktree 用例触发同类超时。单包临时使用 `--maxWorkers 2` 时 297 项通过；最终默认 `pnpm check:vscode` 重跑完整通过。没有修改测试时限、断言、默认并发策略或跳过用例。现象显示执行时间波动，但未确证根因，不能把最后通过解释成已修复测试稳定性。

Svelte 类型检查仍报告现有共享组件 warning，零 errors。构建保留 Vite 提示性 chunk warning 和 Windows pnpm shell 的 Node 弃用警告。

本轮未运行 Rust 构建/测试、Desktop GUI smoke、Desktop ZIP 打包/验证、Extension Host E2E 或发布。Desktop CLI 参数测试在隔离工作区执行，不启动真实构建或窗口。clean 的拒绝参数路径也在隔离工作区验证，未清理现有 artifacts。源码归档仅检查改名和参数拒绝，未运行已知有选文件范围问题的打包逻辑。未推送或打 tag。

## 日志

日志保存在忽略的 `tmp/` 中，不随 Git 提交；本文件保留验收结论。

- `tmp/workspace-commands-final-check.log`
- `tmp/workspace-commands-check-vscode-retry.log`（最终默认入口成功）
- `tmp/workspace-commands-final-check-vscode.log`（首次超时）
- `tmp/workspace-commands-client-recheck.log`、`workspace-commands-client-two-workers.log`
- `tmp/workspace-commands-build-vscode.log`、`workspace-commands-build-desktop.log`、`workspace-commands-build-desktop-local.log`
- `tmp/workspace-commands-package-vsix.log`、`workspace-commands-verify-vsix.log`
- `tmp/workspace-commands-scripts-isolated.log`、`workspace-commands-desktop-packaging-tests.log`

## 未纳入本轮的已知缺陷

- `scripts/package-source.mjs` 沿用原 filesystem blacklist；可能纳入构建产物或未跟踪的本地文件。改名不代表归档范围已修复。
- `scripts/publish-marketplace.mjs` 仍通过参数传递 PAT，通用 runner 的错误文本可能包含参数；发布路径仍会另外打包。此次没有访问凭证或执行发布，缺陷待独立处理。
