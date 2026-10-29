# 验证结果

受测对象为 `refactor/workspace-commands` 在 `f9cffb3` 后的本轮修订。环境是 Windows/MSYS、Node 24.12.0、pnpm 10.13.1，使用现有 Rust MSVC 工具链，没有安装新工具链。本记录与实现一同提交；实际运行命令时工作区尚未提交，产物不是正式发布。

## 入口与文档

- 根 package scripts 从 20 条减为 14 条，全仓从 65 条减为 42 条。
- 五个子包仅保留 build/clean/lint/typecheck/test，Desktop 额外保留 start/package:app/verify:package。内部构建、watch、设置生成、E2E、smoke、Rust、诊断及 CI 准备不再占用 package 别名。
- 自制 source ZIP 与一键本地 Marketplace 发布脚本已删除，相关工作流调用及上传同步移除；手动发布现有已验证 VSIX 可直接使用 vsce。
- 14 个文件中的 70 个本地链接/锚点检查通过；当前使用文档、AGENTS、生成注释和工作流没有失效的旧入口。

## 实际执行

| 命令/检查 | 结果 |
|---|---|
| `pnpm check` | 通过：13 项 Node 工程测试 + 1010 项 Vitest 测试，lint/类型/JS 构建/扩展体积检查通过 |
| `pnpm check:vscode` | 通过：13 项 Node 工程测试 + 836 项 Vitest 测试；无 Desktop 包执行 |
| `pnpm build:vscode` | 通过，只准备共享依赖和扩展 |
| `pnpm build:desktop` | 通过：真实 Tauri/Cargo release 构建，生成 11,807,232 字节 exe；随后完整打包流程再次验证新资源同步 |
| Cargo check（直接工具） | 通过，`--locked --manifest-path apps/desktop/src-tauri/Cargo.toml` |
| Cargo test（直接工具） | 通过：`--features custom-protocol`，1 项 Rust 测试 |
| Desktop packaging 局部测试 | 20 项通过，包括参数拒绝、替换旧后台资源及只复制指定运行文件 |
| `pnpm package:vsix` / `pnpm verify:vsix` | 最终候选通过，78 entries，2.65 MiB；不含内部 build.mjs |
| `pnpm package:desktop` | 通过：完整 JS + Rust 构建，刷新 exe 旁资源，再生成 ZIP |
| Desktop ZIP 静态检查 | `verifyArchive` 通过，版本 0.16.0、清单和 payload hashes 符合契约；不是 GUI 验收 |

两条常规 gate 日志都没有 Tauri/Cargo/Rust 调用。全仓 JS 构建中，客户端、RPC、provider-usage 各 build 一次，两个产品各编译一次。扩展 gate/VSIX 日志没有 Desktop 执行。专项操作不再依赖已移除的 package 命令。

## 运行资源和打包边界

旧 Native 编译链没有刷新 exe 旁 backend.cjs/Pi 扩展的步骤。初始文件时间较旧，但内容哈希与本次输出相同，因此没有声称已复现旧后台功能错误。新增单元用例显式放置旧后台，验证共享复制函数会替换它；Native build 和 ZIP staging 使用同一个复制函数。

实际完整打包后，`dist/` 与 `src-tauri/target/release/` 中 backend.cjs、session-tree.js、question-tool.js 三份资源 SHA-256 均一致。完整 build 的日志包含 Rust release 完成和 `with current backend and Pi extensions`。

VS Code 内部构建文件改名后，原先的 `*.config.*` 排除规则不再覆盖它。已补 `.vscodeignore` 和 verifier 规则：含该文件的旧候选按预期被拒绝，重新打包后的 78-entry VSIX 验证通过。最后这项打包规则变更执行了专门的拒绝/重新打包/验证与 lint；未因此重复整轮应用测试。

## 产物身份

- `artifacts/FrostPi-0.16.0.vsix`：2,776,412 bytes；SHA-256 `e41930b7a7b02255beee5f010c8c3a2a8c8497e6a36eb141146448b56cd53655`。
- `artifacts/FrostPi-0.16.0-win32-x64.zip`：5,806,564 bytes；SHA-256 `ff87d8f6adff21c1c054b90abdbc1c2db89fae1047447ba133df621f1ce7505d`。

Desktop ZIP 构建时 dirty=true，未生成 GUI verification report。它只是完成静态检查的候选包，不能通过正式 release preparation，不是可宣称已 GUI 验收的产物。

## 限制

本轮没有运行 Desktop GUI smoke、`verify:desktop`、人工验收、Extension Host E2E、GitHub Actions 或真实模型请求，也没有清理现有用户数据、推送、打 tag 或发布。只验证当前 Windows 环境，未实际运行其他 OS 或最低 Node 版本。本轮最终两条默认 gate 一次通过，没有改并发、时限、断言或跳过用例；先前 f9cffb3 验证中的 5 秒测试超时波动不代表本轮已修复其根因。

Svelte 现有 a11y warning、Vite vendor/chunk 提示和 Windows pnpm shell 的 Node 弃用警告仍存在，未扩大范围处理。

## 日志

日志保存在忽略的 `tmp/` 中，本文件保留关键结论。

- `workspace-commands-v2-final-check.log`、`workspace-commands-v2-final-check-vscode.log`
- `workspace-commands-v2-build-vscode.log`、`workspace-commands-v2-build-desktop.log`
- `workspace-commands-v2-cargo-check.log`、`workspace-commands-v2-cargo-test.log`
- `workspace-commands-v2-runtime-tests.log`
- `workspace-commands-v2-package-vsix-final.log`、`workspace-commands-v2-verify-vsix-final.log`、`workspace-commands-v2-tooling-guard.log`
- `workspace-commands-v2-package-desktop.log`、`workspace-commands-v2-static-desktop-archive.log`
