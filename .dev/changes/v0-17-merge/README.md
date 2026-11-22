# FrostPi v0.17.0 合并跟踪

本 change 只跟踪本版的合并决策和发版验收。

**本地基线：** `quasi-main @ d254efb`，尚未推送。已按顺序合入 #13（`af8bf82`）和 `fix/session-title-sync`（`15bb0ec`）。标题同步在启动时只采用 Pi 实际保存的名称；与 #13 的组合回归 77 项通过。

## 待合并候选

| 候选 | 行为 | 状态 |
|---|---|---|
| [#24](https://github.com/frostime/pi-vscode-ui/pull/24) · `f22119b9` | 防止上一轮的旧状态把下一轮标为空闲，影响忙时 Fork 和 `/new`。 | 审查与回归通过，待确认纳入。[审查](reviews/PR-24.md) |
| [#33](https://github.com/frostime/pi-vscode-ui/pull/33) · `641f07dc` | 工具调用留在原轮次，避免 Focus View 提前折叠。 | 审查与回归通过，待确认纳入。[审查](reviews/PR-33.md) |
| [#34](https://github.com/frostime/pi-vscode-ui/pull/34) · `d50b89d9` | 普通 `@` 搜索默认不递归跟随符号链接，保留显式目录搜索。 | 可选，定向验证通过，待决定默认值。[审查](reviews/PR-34.md) |

[执行与验收清单](v0-17-merge.PLAN.md) 记录余项处理顺序、发版选择和实机验收。
