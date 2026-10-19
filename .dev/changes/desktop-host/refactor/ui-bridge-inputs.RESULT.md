# 插件重构验证：eb05c72

代码在 `refactor/desktop-bridge-inputs`，包含 R1 的 core/shared 提取与 R2a 的原位宿主输入解耦。`45a2e72` 是 R2a 生产实现，`eb05c72` 只追加测试断言修正。后续文档提交不改变这些代码。

以下是该快照的验证，不是 Desktop 验收。日志在实施 worktree 的 Git-ignored `tmp/`。

| 命令 | 实际结果 | 日志及退出码文件 |
|---|---|---|
| `pnpm check` | exit 0；120 文件、799 项，lint/typecheck/build/预算通过 | `ui-bridge-final-check.log/.exit` |
| `pnpm package:vsix` | exit 0；FrostPi 0.15.5，78 entries，2.65 MB | `ui-bridge-final-package.log/.exit` |
| `pnpm verify:vsix` | exit 0 | `ui-bridge-final-verify-vsix.log/.exit` |
| `env -u ELECTRON_RUN_AS_NODE pnpm --dir apps/vscode test:e2e` | exit 0；VS Code 1.142.0 | `ui-bridge-final-e2e.log/.exit` |

测试使用隔离的 `PI_CODING_AGENT_DIR=.../tmp/ui-bridge-agent`、fake Pi 与合成 Provider 数据。受控 E2E 覆盖扩展激活、命令注册和 fake Pi 新建/停止，不证明完整 UI、真实 Pi、远程或跨平台行为。

R2a 差异 `45a2e72^..45a2e72` 经独立只读审阅，无新增发现；真实用户运行反馈见[接续入口](../desktop-host.ORCH.md)。未安装 VSIX，未替换稳定插件。
