# 命令体系与工程文档整理

## 目标与范围

根命令按全仓任务和常用产品流程组织，子包拥有具体实现。开发者能够判断一个入口检查哪些模块、是否构建 Rust、是否启动窗口、是否发布。修改命令时同步调整 `.dev/docs/`，不新增重复的完整命令手册。

保留既有独立性：VS Code 开发、构建和发布不依赖 Desktop；普通全仓检查不要求 Rust 或 GUI。公开 Desktop 打包入口始终完整重建。开发启动仅隔离 FrostPi 数据，自动测试隔离 Pi 和 FrostPi 数据；本轮不改变 profile 或发布门槛。

## 预期行为

- 根 `build` 对五个包各构建一次。新增 `build:vscode`、`build:desktop`，只构建共享依赖和所选产品的 JS/TS 产物。
- 保留子包 `build` 的独立完整性；产品内部自身编译用 `build:local`，不要求开发者手动准备依赖。
- 根 `package:zip` 改名为 `package:source`，删除根的 VS Code-only `test:watch`。五个子包均提供 `test:watch`。
- Desktop 人工验收、发布准备在子包提供 `test:manual`、`prepare:release`；根只转发。Desktop 本地 `check:native` 汇总 Rust 编译检查及测试，与根入口语义一致。
- 工程脚本纳入 lint。不支持的编排参数报错，不能静默忽略或因拼写错误执行全仓任务。
- `development.md` 负责安装、构建、启动；`testing.md` 负责检查选择和证据；`release.md` 负责交付及发布门槛。保留测试归属和非显然约束，不复述底层实现及完整测试清单。

## 验收

实际全仓及产品独立构建成功，调用日志证明每个共享包在一次构建中只构建一次。常规检查、工程脚本回归测试通过；非法参数在执行构建、检查或清理前失败。CI、调试任务、README 和文档不再引用移除的命令。Native、GUI、打包及发布行为不因命令整理偷偷改变。

源码归档文件选择、Marketplace 凭证处理属于另列缺陷，不在本轮修复。不搬迁共享 UI 测试，不新增 `check:desktop`，不恢复 CI 自动触发，不发布或推送。
