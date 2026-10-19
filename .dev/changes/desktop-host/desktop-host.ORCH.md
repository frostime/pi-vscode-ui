# Desktop 副产品：接续入口

先读 [TARGET-SPEC](desktop-host.TARGET-SPEC.md)：目的、产品效果、架构质量及用户原话。本文件只记录当前状态和接下来的工作。

## 代码与已验证事实

控制状态只在 `feat/desktop-host` 维护；其他分支的同名文件是提交快照。接手其他 worktree 时，可用 `git show feat/desktop-host:.dev/changes/desktop-host/desktop-host.ORCH.md` 取当前入口。

| 位置 | 用途 |
|---|---|
| 主目录，`feat/desktop-host` | 控制状态；**尚未合入重构生产代码** |
| `.worktrees/261019_desktop-bridge-inputs`，`refactor/desktop-bridge-inputs` | 当前实现候选，包含 R1 与 R2a；从这里看新代码 |
| `.worktrees/261011_desktop-host-boundary`，`refactor/desktop-host-boundary` | 原 R1 对照，非当前施工入口 |

R1 已提取 `packages/pi-client` 的 core/shared；R2a 已原位隔离部分 UI/Bridge 宿主输入。**共享 UI 尚未提取，Desktop 尚未创建，双产出的日常开发机制尚未建立。** 现路线以 Electron 薄宿主复用 Node/TypeScript 为候选，尚无桌面运行证据。

已验证代码快照为 `eb05c72`，当前候选后续仅改文档；[验证记录](refactor/ui-bridge-inputs.RESULT.md)保留自动检查证据。用户在 Session `01a15060` 的 `c4e1dc3d` 反馈“测试了一下，似乎都是正常的”，没有逐项明细。

开工前重新核对 Git。当前本地 main 基线是 `2ed69c1`；实施候选必须包含最新 main，若同步了生产变更需重验，不能只更新规划分支。尚未合入 main 或发布。

## 接下来

[最小真实双端复用] << CURRENT
#TODO: 从现有 UI 出发，确认最小提取与宿主接线范围，再实施共享链路，按 TARGET-SPEC 的质量标准验收。

先看候选中的 `apps/vscode/src/webview/shell/SidebarShell.svelte`，沿现有组件和会话动作判断怎样复用；边界依该 worktree 的 AGENTS 与最近模块 SPEC。

此前 HTML 原型未获批准，已移除，不能作为删减或重做现有功能的依据。文档整理不授权生产合并、发布或产品行为变更。

旧调研、Ticket、SOP 与 handover 已退出活动目录；需要追查时从 `9a308d4` 的 Git 树读取，不作为当前执行指令。
