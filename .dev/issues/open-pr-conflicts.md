# 开放 PR 之间的已知冲突与待决策点

**状态：预扫描备忘，供后续排期与 review 时核对。** 记录于 0.17.0 发布后（基线 `6a88072`, 2026-11-25）。逐项做了 `git merge-tree` 干跑与文件清单比对；只有文本冲突证据，未做语义验证。

以下各组互相阻塞或需要先做方向决策，**都不属于 0.17.1 候选批次**（候选批次内已含的配对见对应 change 单元的 watchpoints）。

## 1. #19 × #30：同一队列语义，两个实现

- #19（Queue prompts while Pi compacts）与 #30（Edit, reorder, and steer queued messages）都改 `SessionRuntime` 与 `QueuedPromptRecovery`，`git merge-tree` 确认直接冲突。
- 两者不是补丁关系，是对"Pi 忙时消息排队"的两次独立设计。先合哪个，另一个基本要重写。
- 需要先决策：保留哪条队列语义（#19 的 compaction 期间持有提交，还是 #30 的可编辑队列），或要求作者基于另一方重做。

## 2. #20 × #29：链接确认的两种取向

- #20 让点击的 web 链接走 VS Code 原生确认对话框（`openExternal` 是唯一 opener）；#29 自建确认卡片并删除远程 Markdown 图片加载（−1173 行）。
- `MarkdownHtml.svelte`、`markdown.SPEC.md`、`markdownLinkClick.dom.test.ts` 直接冲突；同一需求两种实现。
- #29 还包含产品取向变更（聊天中的图片链接一律变占位符），属于需要维护者表态的方向问题，不能当普通补丁合并。
- 需要先决策：链接确认走哪条路；#29 的"图片惰性化"是否是产品想要的。

## 3. Bridge 版本号竞争：#35（3.7）× #14（3.6）× main（3.5）

- main 现为 `BRIDGE_VERSION = "3.5"`。#35 声明 3.7，#14 声明 3.6，两者都改 `bridgeVersion.ts`。
- 谁先落地谁生效，后合者必须重取号并确认协议兼容，否则页面与 Host 互相拒绝消息。合入任一 bridge PR 前检查此文件。

## 4. 基于 #13 的堆叠分支全部未 rebase

- #36、#37、#38、#39、#40、#23、#14 都基于 0.16.7（`80ccbe8`），落后 39 个提交。当前 diff 混入 #13 的全部改动（#37 甚至把 main 上已有的测试显示为删除），**真实规模与冲突在 rebase 前无法评估**。
- 这些分支都是 fork/会话生命周期核心能力，不会进补丁版本；但在下一轮排期前，需要作者（或维护者接手）先 rebase 到 main，再按真实 diff 分批。

## 5. #45 更换会话列表存储位置

- #45 把 `ClientHostInputs.storage` 的实现从 `context.workspaceState` 换成 Extension Host 侧文件（`frostpi-state.json`），旧数据一次性迁移。
- 对已发布版本是单向变化：换机器连接远程文件夹后看不到旧列表（只读一次即迁移）。合并前需确认接受这个用户可见的影响。
- 后续任何想往 `HostMemento` 写持久化状态的工作（如 #37 的会话标签页恢复）都依赖 `HostMemento` 接口保持不变；#45 合入后不要再有代码直接引用 `workspaceState`。

## 6. #44 × #27：`collapseTurnTrace.ts` 的相邻改动

- 两者都改 `apps/pi-client/src/ui/features/conversation/collapseTurnTrace.ts`。#44 改已结束轮次的分段折叠，#27 在折叠摘要里加工具图片。
- 文本可合并（`merge-tree` 干净），但语义上折叠分段的摘要渲染必须保证工具图片入口仍可达。#27 的 review 需要带上 #44 合入后的行为。
