# FrostPi v0.17.0 合并跟踪

本 change 只跟踪本版的合并决策和发版验收。

**阶段基线：** `origin/main @ d459535` 包含 #13、本地标题同步和 VS Code 关标签联动修复。#24、#33 和 #34 已分别通过合并提交 `31c7fb0`、`49ca530` 和 `ba395a2` 纳入本地 `quasi-main`，完整检查通过，未推送。未打 tag、未发版。

## 已合入的候选

| 候选 | 行为 | 状态 |
|---|---|---|
| [#24](https://github.com/frostime/pi-vscode-ui/pull/24) · `f22119b9` | 防止上一轮的旧状态把下一轮标为空闲，影响忙时 Fork 和 `/new`。 | 已合入 `quasi-main`。[审查](reviews/PR-24.md) |
| [#33](https://github.com/frostime/pi-vscode-ui/pull/33) · `641f07dc` | 工具调用留在原轮次，避免 Focus View 提前折叠。 | 已合入 `quasi-main`。[审查](reviews/PR-33.md) |
| [#34](https://github.com/frostime/pi-vscode-ui/pull/34) · `d50b89d9` | 普通 `@` 搜索默认不递归跟随符号链接，保留显式目录搜索。 | 默认关闭，已合入 `quasi-main`。[审查](reviews/PR-34.md) |

本版不再追加候选 PR。[#27：按需查看工具图片](../../issues/tool-result-images-on-demand.md)和 [#28：同一工作区或 Project 内继承模型](../../issues/inherit-model-within-workspace.md)已记录到 `.dev/issues/`，不阻塞 v0.17.0。

[收敛与验收清单](v0-17-merge.PLAN.md) 记录剩余的发版范围决定和实机验收。
