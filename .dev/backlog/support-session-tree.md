---
created: 2026-07-20
updated: 2026-07-24
status: implemented
implementation: bundled-private-pi-extension
---

# 支持 Pi Session Tree 导航

## 状态

已通过 feature-specific bundled private Pi extension 实现，达到 v0.8 release-ready 范围。当前任务不修改产品版本和 CHANGELOG。

权威材料：

- `backlog/support-session-tree.DEV-SPEC.md`：产品行为、架构边界、失败语义与验收标准。
- `backlog/support-session-tree.PLAN.md`：实施阶段、验证记录和文件增量。
- `docs/protocol/pi-rpc-compatibility.md`：Pi RPC 与 private extension 兼容边界。
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`：in-place 导航生命周期。

## 已实现范围

- completed user message 上的 **Branch here**：恢复文本与通过现有附件校验的图片，在同一 Pi session 中编辑并重提。
- conversation branch point 上的 **Switch branch · <count> paths**：使用 VS Code QuickPick 选择可达 branch end。
- no/default/custom-focus branch summary；默认 no summary。
- generated branch summary 作为默认折叠的 conversation boundary。
- 同一 FrostPi session id、Pi process 和 Pi session file 内完成导航；Fork 仍创建独立 FrostPi session。
- capability discovery、private command hiding、collision suffix、per-runtime token/result directory、bounded metadata result 和清理。
- pre-commit failure 保留当前投影；confirmed commit 后 hydrate failure 保持 Pi 权威并进入 retryable failed-history。

## 实现边界

Pi RPC 可通过 `get_entries` 读取完整 entries 和 active `leafId`，但没有原生 `navigate_tree`。FrostPi 将 `apps/vscode/pi-extensions/session-tree.ts` 构建到 packaged `dist/pi-extensions/session-tree.js`，并通过绝对 `-e` 路径注入每个 Pi RPC process。private command 调用 Pi extension context 的 `ctx.navigateTree()`；FrostPi 不修改 session JSONL，也不复制 Pi 的 leaf/context mutation 规则。

Runtime 仅保留去除内容和图片 bytes 的 compact tree index。打开 picker 或执行导航时重新获取 authoritative complete entries。

## 延期项

- 完整 Webview tree graph。
- `/tree` Composer command。
- Command Palette tree browser。
- 通用 bundled-extension RPC framework。
- Pi 原生 `navigate_tree` RPC 迁移；若 upstream 后续提供稳定接口，可在保持产品行为的前提下替换 private adapter。
