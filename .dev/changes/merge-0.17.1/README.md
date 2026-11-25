# merge-0.17.1

> 本 change 遵循 `change-based-development` SKILL。
> **状态：进行中（协调批次）。** 创建：2026-11-25；更新：2026-11-25。

协调 0.17.1 补丁版本的候选 PR 批次：按 PR 状态、合并顺序与互斥关系跟踪，直到本批全部落地后归档。

## 边界

- **只做协调**：这里不做逐行 code review，不改源码。每个候选在独立会话中用 `review-code-correctness` 与 `review-code-maintainability` review，只传入本文件为该 PR 写的 watchpoints。
- **基线**：`main` @ `6a88072`（0.17.0）。计划基于此提交建立；main 前进后需重查本批冲突。
- 批外的冲突与决策备忘见 [.dev/issues/open-pr-conflicts.md](../../issues/open-pr-conflicts.md)。

## 候选集

| 项 | 内容 | 状态 | 来源 |
|---|---|---|---|
| #20 | 链接点击走 VS Code 确认对话框 + 右键复制 | pending review | 外部 PR，CI 绿。体量：8 files，+264/−4 |
| #44 | 结束轮次在关闭 Worked 摘要时保持分段折叠 | pending review | 外部 PR，CI 绿。体量：9 files，+44/−11 |
| #21 | `@` 提及按子串匹配（workspace listing） | pending review | 外部 PR，CI 绿。体量：9 files，+527/−38（新增独立模块） |
| #22-前半 | 新增 `frostpi.closeSession` 命令（可绑键）。Rename 半已由 #13 解决，回复 issue 即可 | pending review | 自研。预估 3–4 files（package.json、registerCommands.ts、1 个测试），约 30 行 |
| #32 + #31 | Enter 发送 / Ctrl+Enter 换行的键位选项（issue #32，PR #31 为参考实现） | blocked：待定实现来源与默认值 | issue + 外部 draft PR。#31 实际体量：21 files，+83/−16；自研预估 8–10 files |

不在本批：#19、#25、#26、#27、#29、#30、#35、#36–#40、#23、#14 及其它，理由与批外冲突见备忘文件。

## 合并顺序（串行落地，review 可并行）

外部 PR 先落，自研最后（自研要重跑 `generate-setting-defaults.mjs`，只跑一次）：

1. **#20** → 2. **#44** → 3. **#21** → 4. **#22-前半（closeSession 命令）** → 5. **#32**

#20/#44/#21 三者互不锁定，review 可完全并行；落地顺序内定的理由只是让外部 PR 先清场。

## 批内互锁关系（哪些必须串行、哪些可并行）

| 配对 | 关系 | 处理 |
|---|---|---|
| #20 ↔ #22-前半 | 都改 `registerCommands.ts`（新增命令的邻近区块） | 串行；后落地者解决几行文本冲突 |
| #44 ↔ #32 | 都改 `apps/vscode/package.json` 设置区与两个 `*.generated.ts` | 串行；每次落地后重跑生成脚本，确认生成文件无手改 |
| #20 ↔ #44 | `package.json` 不同区块（menus vs settings 描述），merge-tree 干净 | 可并行 |
| #21 ↔ 其它全部 | 仅 `CHANGELOG.md` 重叠 | 完全独立，可随时插入 |
| #32（若接 #31）↔ #30 | #31 的 Alt+Enter 队列语义与 #30 的队列改动相邻 | 接 #31 前先确认 #30 不在本批后续 |

## 各 PR watchpoints（review 会话只传对应条目）

- **#20**：只核对 markdown 链接路由与两个新复制命令。批内其余 PR 不触碰此区域。注意备忘第 2 条：#29 与本 PR 是同一需求的竞争实现，review 结论不要预设 #29 的做法。
- **#44**：只核对 `collapseTurnTrace.ts` 与设置说明。#27 也改同一文件但不在本批；review 时确认分段 id 稳定性假设不被破坏。
- **#21**：只核对 `host/file-search/*`。共享端零改动；确认 fd 依赖与 7 秒预算的处理不阻塞 Extension Host。
- **#22-前半**：确认命令无默认快捷键、无会话时的启用条件，与 #20 新增命令互不影响。
- **#32**：解开 blocked 后补写。三个待定项：接 #31 还是自研；默认值保持 Ctrl+Enter 发送还是改为 Enter 发送；Enter 模式下 Ctrl/Cmd+Enter 的行为。

## 状态流转

状态取值：`pending review` / `ready to merge` / `blocked` / `removed from batch`（附一行理由）。review 通过后在此表更新；全部落地后归档本目录。
