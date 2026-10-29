# 执行计划

## Mainline

1. 原准备分支已合入 quasi-main（`5e4e879`），首次命令整理已提交 `f9cffb3`。
2. 按用户确认的新边界收回内部和专项入口，完成 Desktop 全程序构建和配套资源同步。
3. 验证完成，追加 checkpoint 提交；本轮不自动合回 quasi-main，不发布/推送。

## Current Phase

实施和验证已完成，结果保存在 `refactor/workspace-commands`。根命令 20→14，全仓 65→42；不是靠改名继续保留所有内部阶段。

文档 worker 完成六篇调整，主 Agent 对照源码复核了前置条件、副作用、版本/源码交付与产物边界。独立只读 reviewer 未发现阻塞问题；主 Agent 进一步检查实际 VSIX，补上内部 build.mjs 的打包排除规则并重新验证。最新运行结果见 [VERIFICATION.md](VERIFICATION.md)。

## Items

### I1 · 完整产品构建与内部 JS 编排

requirement / done。公开 Desktop build 包含 JS、Rust 和 exe 旁运行资源；内部 JS gate 不编译 Rust。共享依赖一次准备，Native build 与 ZIP 共用资源复制函数。实际完整构建和资源哈希比较通过。

### I2 · 移出专项入口与删除重复能力

requirement / done。watch/settings/E2E/smoke/native/inspect/version check/release prepare 改用脚本或标准工具。自制 source ZIP 和一键本地发布脚本删除；已有 vsce 保留必要手动发布能力。CI/debug 调用同步。

### I3 · 文档及生成说明同步

requirement / done。六篇工程文档、README、AGENTS、provider CLI 契约和生成文件注释同步。实际运行设置生成及 --check；70 个本地链接/锚点通过。没有另建一批转发脚本。

### I4 · 验证与提交

checkpoint / verified。全仓 gate：13 Node + 1010 Vitest；扩展 gate：13 + 836；Cargo check/test、完整 Native 构建、VSIX 和 ZIP 打包及静态验证通过。GUI/E2E/人工验收未运行，Desktop ZIP 仍是候选而不是 GUI 已验证交付物。产物身份及日志见 VERIFICATION。
