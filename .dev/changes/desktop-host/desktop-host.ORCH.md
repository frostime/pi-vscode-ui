# Desktop 副产品：接续入口

## 要得到什么

**VS Code 插件是主产品；Desktop 是复用现有优势、可脱离 VS Code 使用的副产品。不是把项目迁成桌面优先，也不是重写一个客户端。**

通用聊天 UI 和会话能力只维护一份。日常调整消息、工具展示、输入框等通用 UI，应自然进入两个产出；VS Code 专属功能仍可单独开发。共享契约或宿主能力改变时，要能明确识别 Desktop 的适配责任，而不是要求插件开发者时时考虑另一端。

Desktop 是多开 Pi 终端的 GUI 替代品：对话优先，默认显示全部已打开的 Pi，目录管理从简。使用本机 Pi；切换前台不停止后台，也不改变已有会话的 cwd。Pi 仍拥有对话文件。VS Code 专属集成，包括未来向 Pi 提供编辑器状态的扩展，留在插件宿主。

## 先读用户原话

加载 `read-pi-session-history` skill，按 Session ID 和单条 Entry 读取，不需要通读历史：

| Session | Entry | 用途 |
|---|---|---|
| `01a15060-927e-7724-9dee-5df399fd9ad7` | `a0ff3a43` | **先读**：主插件、副产品及日常开发应怎样同步 |
| 同上 | `ac887d8d` | 现有 New/Resume 就在 UI 里，为什么不能另起一套 |
| 同上 | `704e742c` | 全部 Pi、对话优先的界面方向 |
| `01a12ae2-065f-77ce-8ae0-9b463d3b9410` | `c03bb6e7` | 插件开发只需守边界；切目录不影响后台 |

这些是理解目的的来源，不是已经定稿的组件接口或布局。此前 HTML 原型未获批准，已移除，不能据其删减或重做现有功能。

## 代码与已验证事实

本计划只在 `feat/desktop-host` 维护；其他分支的同名文件是提交快照。接手其他 worktree 时，可用 `git show feat/desktop-host:.dev/changes/desktop-host/desktop-host.ORCH.md` 取当前入口。

| 位置 | 用途 |
|---|---|
| 主目录，`feat/desktop-host` | 控制状态；**尚未合入重构生产代码** |
| `.worktrees/261019_desktop-bridge-inputs`，`refactor/desktop-bridge-inputs` | 当前实现候选，包含 R1 与 R2a；从这里看新代码 |
| `.worktrees/261011_desktop-host-boundary`，`refactor/desktop-host-boundary` | 原 R1 对照，非当前施工入口 |

R1 已提取 `packages/pi-client` 的 core/shared；R2a 已原位隔离部分 UI/Bridge 宿主输入。**共享 UI 尚未提取，Desktop 尚未创建，双产出的日常开发机制尚未建立。** 现路线以 Electron 薄宿主复用 Node/TypeScript 为候选，尚无桌面运行证据。

已验证代码快照为 `eb05c72`，当前候选后续仅改文档；[验证记录](refactor/ui-bridge-inputs.RESULT.md)保留自动检查证据。用户在本轮 Session 的 `c4e1dc3d` 反馈“测试了一下，似乎都是正常的”，没有逐项明细。

开工前重新核对 Git。当前本地 main 基线是 `2ed69c1`；实施候选必须包含最新 main，若同步了生产变更需重验，不能只更新规划分支。尚未合入 main 或发布。

## 接下来

[最小真实双端复用] << CURRENT
#TODO: 从现有 UI 出发，确认最小提取与宿主接线范围，再实施共享链路，不再先设计一套独立 App UI。

先看候选中的 [SidebarShell.svelte](../../../.worktrees/261019_desktop-bridge-inputs/apps/vscode/src/webview/shell/SidebarShell.svelte)，沿现有组件和会话动作判断怎样复用；边界依该 worktree 的 AGENTS 与最近模块 SPEC。New/Resume 等已有能力不是待重新发明的需求。

下一段交付应证明：真实桌面窗口与插件消费同一份通用 UI/会话实现；改一处通用 UI 能进入两端；插件仍能独立开发、构建和使用，并验证真实 Pi 的发送、停止、历史恢复。开发约定须说明哪些改动无需 Desktop 特别处理，哪些必须适配；用代码边界与检查支撑，不只写说明。

集合/草稿归属、桌面不支持的宿主操作，以及关闭、重开恢复和平台范围尚未决定；遇到影响当前实现的取舍再确认。当前按钮的具体位置和 Space 点击行为也未定稿。文档清理不授权生产合并、发布或产品行为变更。

旧调研、Ticket、SOP 与 handover 已退出活动目录；需要追查时从 `9a308d4` 的 Git 树读取，不作为当前执行指令。
