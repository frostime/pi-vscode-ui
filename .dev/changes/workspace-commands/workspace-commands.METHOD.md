# 当前实施方法

在 `refactor/workspace-commands` 的 `f9cffb3` 上继续修订，不改写旧提交或再次合并 quasi-main。

根 `scripts/build.mjs` 是 Rust-free JS 编排工具，提供 `buildJavaScript(scope)` 给完整 Desktop 构建使用，CLI 供常规 gate 和 Agent 调用。它先运行共享客户端完整 build，再执行各产品自有 `build.mjs`。产品自有 build 文件完成 esbuild 和 Vite；不再通过 package.json 的 build:local 转发。

VS Code 公开 build 调用上述 JS 编排器，Desktop 公开 build 调用所属 `scripts/build.mjs`：先准备 JS，再执行 Tauri/Cargo 生成 exe。Desktop package:app 调用这个唯一完整 build。Rust 完成后用 `packaging.mjs` 的 `copyRuntimeFiles` 刷新 exe 旁后台和 Pi 扩展；ZIP staging 复用该函数，不能依赖目标目录此前留下的资源。根不保留含义模糊的裸 build。

根保留常用产品入口、常规检查、版本设置、产物验证和人工验收；子包保留 build/clean/lint/typecheck/test，Desktop 额外保留 start/package:app/verify:package。专项任务直接调用已有 Node/Cargo/Vitest 工具，不新增命令框架。CI 改用直接版本检查、Rust 命令、E2E runner 和发布准备脚本。自制源码归档和重复本地发布脚本按目标删除。

文档沿用 development/testing/release 分工，添加专项操作的直接调用而非复制全部命令表。设置生成脚本中的 regenerate 注释同步修改并实际重新生成；不能手改生成文件。模块和 root AGENTS 只修正现有入口，不扩写新流程。

验证仍使用隔离参数拒绝测试，避免失败 guard 触发真实清理/构建；删除只为已删入口存在的测试。完整 Native 构建不打开 GUI；若运行 GUI 必须先告知。默认测试超时或并发不因执行波动而改写。实际结果与未验证边界见 [VERIFICATION.md](VERIFICATION.md)。
