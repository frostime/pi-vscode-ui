# 执行计划

## Mainline

1. 旧分支合并完成：`chore/prepare-0.16.0` 已用非快进合并进入 `quasi-main`，提交 `5e4e879`；版本规则和 diff 检查通过。
2. 命令与文档整理完成：实现根产品构建、依赖去重、Desktop 本地入口、参数验证、工程脚本检查及文档分工。
3. 验证完成：全仓 gate、扩展专用 gate、独立构建、VSIX 打包验证通过。详细结果与测试超时波动见 [VERIFICATION.md](VERIFICATION.md)。

## Current Phase

实施和验证已完成，本轮结果以 `refactor/workspace-commands` 上的 checkpoint 提交保存。本轮改动不自动合回 quasi-main，不推送、不打 tag 或发布。

文档 worker 完成六篇流程文档初稿；主 Agent 已对照代码复核并修正事实及过程残留。独立 reviewer 未发现阻塞问题；主 Agent 用实际命令验证了构建次数、scope 隔离和 Node 测试运行方式。最终代码 gate 通过后只整理本 change 的记录。

## Items

### I1 · 构建去重与范围选择

requirement / done。包范围集中在 scripts/workspaces.mjs；根 build 先准备客户端，再编译所选产品。日志确认五个包各编译一次；独立产品构建和 VSIX 打包仍准备依赖。

### I2 · 入口归属和参数行为

requirement / done。source 改名、子包 watch、Desktop local 入口、native 聚合、工程脚本 lint 和未知参数拒绝已完成；CI/debug/README 调用同步。非法参数测试在隔离 workspace 中运行，不接触真实产物。

### I3 · 工程文档分工

requirement / done。development/testing/release 按用途组织；索引、定位和排错文档同步，不新增命令手册，不把临时 SOP 放回正式文档。68 个本地链接/锚点检查通过。

### I4 · 验证与 checkpoint

checkpoint / verified。最终 pnpm check 为 17 项 Node + 1008 项 Vitest 全通过；默认 check:vscode 重跑为 17 + 836 全通过，未改时限/断言/默认并发。两个产品构建和 VSIX 打包验证通过。Native、GUI、E2E、源码归档和发布未执行，证据边界见 VERIFICATION。
