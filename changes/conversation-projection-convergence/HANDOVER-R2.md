---
title: FrostPi 会话投影收敛第二轮交接
created: 2026-08-01T17:23:57+08:00
round: R2-requirements-and-architecture-clarification
previous: ./HANDOVER-R1.md
continuation: ./DEV_SPEC.md
terminology: ./TERMS.md
---

# Current Status

第二轮已经完成用户需求、产品语义和责任范围澄清，并开始架构方案探索；尚未最终确定内部技术分解，尚未修改产品代码。

当前分支：`wip/conversation-projection-convergence`。

本轮相关提交：

- `7997070`：创建会话投影收敛 Change Spec。
- `0cecac4`：归档第一轮问题溯源 handover。
- `409a11c`：明确自动重试投影的产品语义、责任范围和中文术语。

截至本交接，工作区干净。当前 change 目录包含：

```text
changes/conversation-projection-convergence/
├── DEV_SPEC.md
├── HANDOVER-R1.md
├── HANDOVER-R2.md
├── LIFECYCLE-SOURCE-CLARIFY.svg
└── TERMS.md
```

下一轮继续做架构方案 Clarify。不要直接实现，也不要重新调查已经闭合的 BUG 根因和责任范围。

# R2 Scope

R1 已经证明重复最终回复的直接原因：live 成功回复先位于旧 visual turn；增量 persisted reconciliation 又把同一消息加入新 visual turn；跨 turn 更新没有从旧位置移除消息。full reload 清空 live 状态，所以重复消失。完整证据见 `HANDOVER-R1.md`。

R2 处理的是两个更高层问题：

1. 用户实际期望一次失败后自动重试的执行如何呈现。
2. FrostPi 应通过什么范围和架构保证 live 状态最终收敛到 Pi 会话记录。

# Terminology Decision

用户明确指出此前讨论混用了大量英文术语，导致难以判断产品和架构取舍。本 change 已建立 `TERMS.md`，后续讨论、SPEC、PLAN 和 handover 必须遵循。

面向用户优先使用：

- **用户回合**：一次用户请求及其后续工作，在 FrostPi 中显示为一个整体。
- **执行尝试**：Pi 向模型请求一次结果；自动重试会产生新的执行尝试。
- **会话记录**：Pi 写入磁盘、reload 时可以读取的消息或边界记录。
- **实时信号**：Pi 运行期间发出的状态通知，其中一部分不会写入会话记录。
- **自动继续**：Pi 核心因自动重试或上下文压缩，在没有新用户请求时继续执行。
- **历史投影**：仅根据会话记录构造稳定会话界面的过程和结果。
- **临时界面状态**：尚未由会话记录确认的用户请求、流式回复、工具状态和重试提示。
- **对账**：把临时界面状态与新读取的会话记录合并，并消除临时副本。
- **结果收敛**：增量对账完成后，与全量重建得到相同的稳定内容、顺序、归属和状态。

不要单独使用 `canonical`、`overlay`、`provenance` 等英文架构词。必须讨论源码事件时保留 `agent_start`、`agent_settled`、`auto_retry_start` 等代码标识，并先解释用户含义。

# Confirmed User Requirements

## One user request, one user turn

一次用户请求经历一次或多次 Pi 内部执行尝试，始终表现为一个 user-anchored 用户回合。

自动重试最终成功后的稳定界面：

```text
用户请求
└─ 一个用户回合
   ├─ 默认折叠的工作记录
   │  ├─ 失败执行尝试的部分内容
   │  ├─ 错误记录
   │  └─ 自动重试提示
   └─ 最终成功回复，只显示一次
最终状态：Worked
```

全部自动重试最终失败：同一个用户回合显示 `Failed`，错误记录保留。

用户明确要求失败记录不能完全删除。默认折叠状态只展示最终成功回复；展开工作记录后可以检查失败执行尝试和错误。

该语义不是新发明。entry-backed conversation refactor 之前的 `turn-projection.SPEC.md` 已规定：“一个 user prompt 和所有后续 Pi activity 构成一个 turn”。当前 entry-backed persisted projection 在 terminal assistant 后关闭 turn，偏离了此前行为。

## Retrying is a live status

Pi 已确定会自动重试但下一次执行尝试尚未完成时，用户回合应保持活动，并显示 `Retrying`，不稳定呈现为已经结束的 `Failed`。

Pi 0.81.1 TUI 已验证：

- `auto_retry_start` 创建 `RetryStatusIndicator`；
- `auto_retry_end` 只有最终失败时才额外显示失败；
- 成功时继续显示正常回复。

FrostPi 应对齐这一用户语义，但优先级低于最终稳定投影正确性。允许使用现有 running 状态和 retry notice 达成，不为动画级无闪烁引入延迟队列或新的跨模块状态机，除非实现证据表明确有必要。

## Core correctness has priority

用户明确的优先级：

1. 最终成功回复只出现一次。
2. 最终只有一个用户回合。
3. 错误和失败执行尝试保留在工作记录中。
4. reload 前后核心消息、顺序、用户回合归属和最终状态一致。
5. Working、Retrying 等纯通知性状态只服务当前运行过程，不需要额外持久化，也不要求 reload 后恢复。
6. 中间过程应尽量顺滑；如果顺滑需要显著增加状态和长期复杂度，则接受低成本范围内的不连续。

# Confirmed Responsibility Boundary

## FrostPi must guarantee

- Pi 核心产生的正常用户请求、自动重试、上下文溢出后的自动压缩继续、工具调用/结果和后续用户消息。
- Pi 已持久化的核心消息不重复、不丢失、不重排。
- 同一 Pi 消息在投影中最多有一个逻辑位置。
- persisted reconciliation 可以把 live activity 迁移到稳定位置，但不能复制。
- 对相同 Pi 当前路径，完成后的增量对账与全量重建具有相同的稳定内容、顺序、用户回合归属和状态。
- Webview 只渲染 Host ViewModel，不负责跨 turn 去重或历史修复。

## FrostPi does not guarantee

- 不修改 Pi session JSONL 或 RPC 协议来保存每次执行的来源。
- 不建立 FrostPi 私有 sidecar/关系表记录“哪条回复属于哪个用户回合”。
- 不持久化 `Retrying` 等纯通知性实时状态。
- 不承诺 reload 后还原缺少 user message、displayable custom message 或其他来源信息的任意 Pi extension 独立执行的真实起因和精确用户回合归属。

最后一项只放宽“起因解释和用户回合归属”的责任，不放宽消息完整性。即使 Pi extension 没有留下来源信息，FrostPi 仍不得重复、丢弃或重排它已经持久化的消息。

# Clarification About Pi Extensions

Pi 自动 retry 完全由 Pi 核心拥有。

R2 架构探索曾引入“Pi extension 另行启动模型执行”的边界场景。这里的 extension 是加载到 Pi 进程中的 **Pi extension**，不是 FrostPi。Pi extension 可以调用 Pi API 启动独立模型执行；这不是 retry，也不是原始 BUG 的正常路径。

引入该场景的目的不是要求 FrostPi 保存所有通知，而是检查一个隐藏前提：persisted entries 是否总能说明后续 assistant 为什么执行。事实是 Pi session 不持久化所有 `agent_start`、`willRetry`、run ID、extension command origin 或 continuation reason，因此某些来源无法在 reload 后证明。

用户已经明确选择有边界的责任：保证 Pi 核心对话流程，不为缺失来源信息的任意 Pi extension 补造历史。由此排除两条高成本路线：

- 要求 Pi 上游扩展 session entry 协议；
- FrostPi 自己持久化第二套用户回合关系。

白板 `LIFECYCLE-SOURCE-CLARIFY.svg` 已修正为“Pi extension 独立执行（不是 retry）”，并标记上述责任选择已经确认。

# Verified Technical Facts Added in R2

## Two input paths currently share one mutable projection

`ConversationProjection` 同时处理：

- live events，通过 `#activeTurnId` 管理临时用户回合；
- persisted entries，通过 `#persistedTurnId` 管理历史用户回合；
- visible items、message/tool location maps、pending compaction 和 queued follow-ups。

这形成两个不同分组规则共同修改一个 ViewModel 的结构。当前重复 BUG 是该耦合的已验证失败，而不只是 Webview 渲染错误。

## Stable authority is incomplete in the current contract

当前 conversation projection SPEC 已规定：

- Pi `get_entries + leafId` 是持久化内容和顺序权威；
- live 与 persisted activity 通过 stable identity 对账；
- live turn identity 应被保留。

但 R1/R2 发现现有 SPEC 之前没有明确规定：

- 每个 persisted message identity 全局只有一个投影位置；
- persisted location 与 live location 冲突时谁决定最终位置；
- 增量对账与全量重建必须语义等价；
- stale live replay 不能重新夺取 persisted location。

这些不变量已经加入 `DEV_SPEC.md`。

## Production assistant identity is weaker than tests imply

Pi assistant message 没有始终存在的显式 message ID。当前代码通常用 message timestamp 推导 live/persisted identity；现有测试 helper 经常注入显式 id，因此没有覆盖真实生产路径。

后续设计必须：

- 把 timestamp 只当作经过冲突检查的关联候选；
- 不能把两个不同 persisted entries 因 timestamp 碰撞而合并；
- 无法无歧义关联时，进入 full replacement 或 persisted-only recovery，而不是按正文猜测。

## Buffered history replay has no snapshot watermark

Session history load 期间会缓存 live events，完成 full replacement 后再重放。Pi 的 event 通知与 session append 之间没有可供 FrostPi 使用的 snapshot watermark，因此一个 buffered event 可能已经被 snapshot 表示。

结果：replay 必须幂等。已经由 persisted state 表示的 message 或 compaction 只能更新稳定位置，不能生成第二份或移回临时位置。

## Compaction continuation shares the same convergence problem

上下文溢出路径可以产生：

```text
user
→ assistant(error)
→ compaction
→ assistant(success)
```

live 阶段属于一个用户回合；persisted entry projection 也必须收敛为同一个用户回合。compaction entry 不持久化 `reason=overflow` 或 `willRetry`，所以历史投影需要使用已接受的 Pi 核心消息语法，而不能声称解释任意 extension causality。

# Architecture Brainstorm Results

R2 对三类架构进行了独立审查。没有最终锁定方案。

## Candidate A: Harden the current mutable projection

中文描述：在现有 `ConversationProjection` 内明确区分“用户回合分组状态”和“当前显示状态”，并修复全局消息迁移。

主要变化：

- 用户消息开启用户回合；Pi 核心自动重试/自动继续复用该用户回合。
- assistant error 记录一次失败执行尝试，但不自动切断用户回合。
- `agent_settled` 决定 live 用户回合最终完成。
- persisted message 已有旧位置时，先从旧位置删除全部 reasoning/response/tool-call parts，再插入权威位置。
- tool identity map 与消息迁移同步。
- `agent_end(willRetry)` / `auto_retry_start` 使 live turn 回到 running/retrying 语义。
- 新 user message 仍是最强、最清晰的 durable turn boundary。

优点：调整集中、迁移成本较低、保留当前 API 和模块边界。

风险：canonical persisted state、provisional live state、identity binding、stale replay 和 view ID adoption 仍共享可变数组和 map；后续开发者可能继续依赖调用顺序维持不变量。增量/full 等价需要跨多个私有字段推理。

## Candidate B: Extract a deterministic historical projector, keep temporary UI state separate

中文描述：在现有模块边界内，将“仅根据 Pi 当前路径生成稳定历史界面”的规则提取为一个确定性的历史投影器；实时事件产生的临时界面状态单独维护，再通过受控关联合并。

概念数据流：

```text
Pi 会话记录
→ 确定性的历史投影
→ 稳定消息、顺序、用户回合和状态

Pi 实时信号
→ 临时界面状态
→ optimistic prompt、streaming、工具、retry notice

稳定历史 + 临时界面状态 + 无歧义关联
→ Host conversation ViewModel
```

主要收益：

- full replacement 和 incremental append 使用同一个历史分组规则；
- persisted location 天然只有一个 owner；
- buffered replay 只影响临时界面状态，不能移动稳定历史；
- 可以分别检查“历史投影”“临时状态”“关联结果”，调试路径更清楚；
- retry 用户回合语义集中在一个历史分组 owner 中。

主要成本：

- 需要两个状态 reducer/owner、关联生命周期和 view ID adoption；
- assistant timestamp 关联歧义不会消失，只会变得显式；
- 如果一次性替换全部当前代码，回归面和迁移成本较高。

独立审查对幅度有两种判断：

1. 一项审查认为 current mutable projection 的 location authority、stale replay 和 pending live state 已达到内部 base+overlay 拆分门槛。
2. 另一项审查认为当前只有 retry duplicate 是已复现故障，应先提取纯历史投影器并增加 characterization tests，只有测试证明共享状态无法清楚维持不变量时，再完整拆分临时状态合并层。

两者共同反对：只加正文去重、Webview 去重、Pi 协议修改、FrostPi sidecar 和 SessionRuntime 整体重写。

## Candidate C: Persist execution provenance

中文描述：修改 Pi 或由 FrostPi 额外保存每次模型执行的来源与用户回合关系。

该方案可以对任意 extension activity 提供最强 reload 归组，但用户已明确不需要这项责任；它引入协议、兼容、同步、分支、fork、外部修改和隐私维护成本。R2 已排除，不再讨论。

# Current Architecture Judgment

当前最有依据的方向是 **渐进式 Candidate B**，但尚未与用户完成技术方案对齐：

1. 保留 `SessionEntryState`、`SessionRuntime`、Host-Webview 和 shared ViewModel 的现有外部边界。
2. 先提取一个确定性的历史投影规则，让 full 和 incremental 使用同一规则。
3. 通过 characterization/convergence tests 判断现有 live mutation 是否还能清楚工作。
4. 如果 location authority、stale replay 或 view identity 仍要求互相冲突的共享状态，再把临时界面状态和关联过程完整分离。
5. 不做 generic event store、Pi protocol change、sidecar、Webview dedup 或大范围 SessionRuntime rewrite。

这个判断是当前技术建议，不是已确认决策。下一轮应向用户用中文、低术语负担的方式比较：

- 直接强化当前投影器；
- 渐进提取历史投影器，再按证据决定是否完整分离临时界面状态。

# Load-Bearing Assumptions

| 前提 | 状态 | 影响 |
|---|---|---|
| `agent_settled` 是当前 Pi 核心 live 执行的完成边界。 | grounded：Pi 事件和 SessionRuntime 均以此返回 ready。 | live turn 可以在此决定最终状态并刷新会话记录。 |
| Pi 核心 provider retry 产生 error assistant，随后产生下一 assistant；overflow recovery 可在中间加入 compaction。 | evidenced：Pi 0.81.1 源码与最小复现。 | 支持本 change 的核心分组语法。 |
| 每个 assistant timestamp 在整个 session 全局唯一。 | open，不可作为硬保证。 | 必须冲突检查；不能把 timestamp 直接当 persisted semantic ID。 |
| history snapshot 一定不包含随后重放的 buffered event。 | broken：没有 watermark，且 Pi 先通知 event 再持久化 message。 | replay 必须幂等并服从 persisted location authority。 |
| persisted entries 能解释任意 Pi extension assistant 的真实起因。 | broken，但已移出责任范围。 | 不修改协议或建立 sidecar；只保证消息完整性。 |
| 纯通知性 retry 状态需要 reload 恢复。 | rejected by user requirement。 | `Retrying` 只需 live 展示，不新增持久化机制。 |

# Remaining Technical Decisions

以下是下一轮真正需要 Clarify 的技术选择：

1. **提取幅度**：只在当前类内重排状态，还是先提取确定性的历史投影器。
2. **增量策略**：历史投影器保存可追加状态并重算受影响尾部，还是每次 settle 重新投影完整已加载 active path。需要结合最大历史大小、性能和证明成本选择。
3. **临时状态合并**：是否立即建立独立 live state owner，还是保留现有 live handling、先通过 stable binding/relocation 与历史投影合并。
4. **view identity**：稳定历史接管内容和位置后，如何继续采用已显示的 live turn/item ID，避免 Webview disclosure state 重置。
5. **retrying live UX**：优先采用 running + retry notice；是否需要新增共享状态必须由实际 UI 缺口证明。
6. **compaction pairing**：live/persisted compaction 优先使用 `firstKeptEntryId` 等结构字段；无歧义关联失败时如何进入保守 refresh。
7. **incremental/full equivalence test**：如何定义归一化快照，排除 view ID、updatedAt 和 live-only notice，只比较 persisted 内容、顺序、归属和状态。

# Next Actions

1. 先读 `TERMS.md`、本文件和 `DEV_SPEC.md` 的“技术决策/架构升级门槛”。
2. 不重新询问 retry 是一个还是两个用户回合；已确认一个用户回合。
3. 不重新询问是否持久化 `Retrying`；已确认纯通知状态无需持久化。
4. 不重新讨论任意 Pi extension 来源；已确认只保证 Pi 核心正常流程和所有 persisted message 的完整性。
5. 用一张简单结构图或短表向用户比较 Candidate A 与渐进式 Candidate B：修改范围、长期复杂度、证明难度、调试路径和迁移风险。
6. 给出 Agent 的技术推荐与会改变推荐的证据，再让用户确认架构幅度。
7. 用户确认后更新 `DEV_SPEC.md` 的技术决策；必要时创建 architecture landing proposal 或 skeleton，但此时不要实现功能。
8. 需求和技术方案均对齐后，再创建实现 PLAN，随后进入代码修改。

# Relevant Files

- `changes/conversation-projection-convergence/DEV_SPEC.md`：当前 change contract，包含已确认行为、责任范围、收敛不变量和验收标准。
- `changes/conversation-projection-convergence/TERMS.md`：强制术语约定。
- `changes/conversation-projection-convergence/HANDOVER-R1.md`：根因、最小复现、Pi retry 持久化证据和最初方案边界。
- `changes/conversation-projection-convergence/LIFECYCLE-SOURCE-CLARIFY.svg`：R2 责任边界解释白板，选择 1 已标记为确认。
- `apps/vscode/src/extension/conversation/ConversationProjection.ts`：当前 live/persisted mutable projection 与直接 BUG 所在。
- `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`：当前 durable projection contract。
- `apps/vscode/src/extension/sessions/SessionRuntime.ts`：event orchestration、history buffering、settle/compaction refresh。
- `apps/vscode/src/extension/sessions/SessionEntryState.ts`：active-path validation、cursor 和 append/reload decision。
- `apps/vscode/test/unit/ConversationProjection.test.ts`：现有投影测试；缺 retry、production timestamp identity 和 convergence matrix。
- `apps/vscode/test/unit/SessionRuntime.test.ts`：现有 runtime tests；缺完整 auto-retry 和 stale snapshot replay。
- `apps/vscode/test/e2e/fake-pi.cjs`：需要增加可重复 retry fixture。
- Pi 0.81.1 `dist/core/agent-session.js`：retry、compaction、persistence 和 `agent_settled` 语义。
- Pi 0.81.1 `dist/modes/interactive/interactive-mode.js`：`RetryStatusIndicator` 与 final retry failure 展示证据。

# Do Not Repeat

- 不把重复回复归因于 Svelte keyed each、Webview collection delta、Pi 保存两份最终回复或 DOM ghosting。
- 不把 Pi 执行尝试等同于 FrostPi 用户回合。
- 不使用消息正文或错误文本做身份匹配。
- 不用强制 reload 掩盖错误的 incremental projection。
- 不因存在任意 extension 理论路径而扩大 FrostPi 持久化责任。
- 不直接上完整 base/overlay rewrite；先比较渐进提取与当前类强化，并由测试和不变量决定幅度。
