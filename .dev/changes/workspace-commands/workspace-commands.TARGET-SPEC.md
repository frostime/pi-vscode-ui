# 清晰的常用入口与独立工程工具

## 用户目标

`package.json` 是常用任务入口，不是全部内部步骤的目录。用户应能从任务名称判断会得到什么产物、是否打开窗口、是否发布。Agent 专用、内部编排和低频专项操作直接使用所属模块的脚本或现有工具，必要用法写在 `.dev/docs/`，不再为每步维护 npm 别名或转发脚本。

不能把命令可执行、进入 CI 或已有测试，当成它值得作为常用入口存在的理由。

## 行为边界

- `build:vscode` 和 VS Code 包的 `build` 生成完整扩展构建文件，不涉及 Desktop。
- `build:desktop` 和 Desktop 包的 `build` 完整构建 JS/renderer 与 Rust，生成 exe 并同步其旁边的后台和 Pi 扩展；只构建 JS 的操作留在内部脚本，不占用含义相同的公开名字。
- `check`、`check:vscode` 仍不要求 Rust 或 GUI；共享依赖在一次内部 JS 构建中只准备一次。公开打包仍完整重建，不从调用者猜测产物是否过期。
- 保留常规 lint/typecheck/test/clean、产品打包/产物验证、版本设置和人工 Desktop 验收。Desktop `start` 保持现有开发 profile 行为，不自动构建。
- 移出 package scripts：build:local/build:native、设置生成/检查、watch、E2E、smoke、Rust 检查/测试、诊断、CI 版本检查与发布准备，以及同一专项操作的根/子包双份别名。已有工具可直接完成的事不另写转发脚本。
- 删除自制源码归档及其 CI 上传，使用 GitHub tag 自带源码下载；删除重复的一键 Marketplace 发布脚本。Tag 工作流继续发布经过验证的同一个 VSIX。必要的手动发布通过已有 vsce 的 packagePath 操作，不再维护独立构建/打包/凭证处理机制。
- 开发 profile、测试隔离、GUI 发布硬门槛、ZIP/报告绑定和 Desktop 不阻塞扩展发布的约束保持不变。

## 验收

实际运行扩展独立构建、完整 Desktop 构建（含 Cargo）、Rust-free 常规 gate 和 VSIX 打包验证。日志确认内部 JS 构建不重复编译共享包。工作流、README、AGENTS、模块契约与生成文件中的命令说明均匹配新入口；文档对专项操作给出可执行调用、前置条件和副作用。不恢复 CI 触发、不发布、不推送。
