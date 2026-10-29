# 实施方法

以 `quasi-main` 合并提交后的 `refactor/workspace-commands` 为工作分支；先前 `chore/prepare-0.16.0` 已按用户要求用非快进合并。

根构建先调用共享客户端的完整 build，再调用所选产品的 build:local。共享客户端继续构建 RPC 和 provider-usage；不另造 DAG 引擎或跨命令缓存。单独产品 build 先准备共享客户端再编译自身，公开打包仍使用完整 build。

在 `scripts/` 集中声明包范围供 build、quality、clean 使用。构建输出检查随产品范围选择，不能让 Desktop-only JS 构建要求已有 VS Code 产物。根 quality 增加工程脚本 lint 和 Node 内置测试，不另加测试框架。

用少量回归测试保护构建依赖去重、产品范围及非法参数提前失败。Node 测试通过在 `scripts/test` 中运行默认发现纳入根 gate；Desktop 入口测试留在 Desktop 包，避免 Desktop-only 脚本错误阻断 check:vscode。参数拒绝测试运行隔离的脚本副本和空 workspace，防止 guard 回归后意外清理实际 artifacts 或触发真实构建。直接执行 Node 时不走 Windows shell，以保留带空格的路径和参数；pnpm.cmd 仍使用 shell。

运行实际构建和常规检查提供集成证据；最终结果和证据边界见 [VERIFICATION.md](VERIFICATION.md)。文档保持现有十篇结构，压缩重复说明和底层实现清单，保留隔离、打包重建、证据绑定及独立发布约束。

源码归档脚本可因入口改名重命名文件，但不改变选文件规则。发布脚本不借本轮重构修改凭证或发布机制。
