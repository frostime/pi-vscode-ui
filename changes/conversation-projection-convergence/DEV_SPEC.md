---
title: Conversation Projection Convergence
created: 2026-08-01
status: clarifying
scope:
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/test/unit/**
  - /apps/vscode/test/e2e/**
---

# 会话投影收敛 Change Spec

## Problem Statement

FrostPi 同时通过两类输入构造会话界面：

- Pi 实时事件用于立即显示用户请求、流式回复、工具执行、自动重试提示和压缩结果；
- Pi session entries 用于在执行结束、历史加载、会话恢复和分支切换后重建持久化会话。

这两类输入描述同一次 Pi 执行的不同阶段，但当前实现分别维护 live visual turn 与 persisted visual turn，没有完整规定它们最终必须如何收敛。

已验证的故障发生在一次用户请求经历失败和自动重试后：

1. 失败的 assistant 消息和成功的 assistant 消息都被 Pi 正常写入 session；成功回复只有一条。
2. live 投影把失败 attempt、重试过程和成功回复放在原 visual turn 中。
3. persisted 投影把失败 assistant 视为 visual turn 结束，并为后续成功 assistant 新建 visual turn。
4. reconciliation 将成功回复加入新 visual turn 时，没有从旧 visual turn 移除同一消息的 live activity。
5. GUI 因此同时在 `Failed` 和 `Worked` visual turn 下显示相同成功回复；reload 清空 live 状态并全量重建后，重复消失。

直接缺陷是跨 visual turn 更新没有完成迁移。更高层缺口是：现有契约规定了 live 与 persisted 消息通过 identity 对账，却没有规定消息位置的权威、全局唯一性、增量与全量投影的等价关系，以及 retry/continuation 对 visual turn 分组的稳定语义。

本变更要修复的是这组投影一致性问题，而不是只对某个截图场景增加内容去重分支。

## Goals

- 让 live 投影在持久化 entries 到达后稳定收敛到权威会话状态。
- 保证同一个 Pi 消息或工具调用不会同时存在于多个投影位置。
- 保证增量 reconciliation 与 full replacement 对同一 persisted active path 产生语义等价的稳定会话。
- 覆盖 provider 自动重试、上下文溢出后的压缩 continuation，以及历史加载期间的 live event replay。
- 明确 Pi 执行 attempt、Pi session entry 与 FrostPi visual turn 的边界，避免用一个概念代替另一个概念。
- 保留 optimistic prompt、streaming、工具状态和 disclosure state 等现有实时体验。

## Non-Goals

- 不修改 Pi session JSONL 格式、parent chain 或 Pi 自身的 retry 策略。
- 不让 FrostPi 截获或重写 Pi 的文件操作和 session 持久化。
- 不为 Pi 增加仅供 FrostPi 使用的新 RPC 消息类型。
- 不通过回复文本、错误文本或时间接近程度猜测两条消息是否相同。
- 不在缺乏必要性的情况下重写整个 SessionRuntime 或拆建通用事件存储框架。
- 不在本变更中重新设计 branch navigation、queued follow-up 或 compaction 的用户界面。
- 不处理与本故障无关的 abort partial-content 持久化差异；该行为需要独立需求与证据。

## Approach

### 1. 明确权威关系

Pi `get_entries` 返回的 active path 是持久化会话内容和顺序的权威来源。Pi entries 不包含 FrostPi visual-turn identity；visual turn 的分组与消息归属由本 SPEC 选定的 FrostPi 分组规则决定。应用该规则后的 persisted projection 是稳定位置的权威。

实时事件只提供尚未持久化或尚未完成 reconciliation 的临时状态。live 状态可以先于 persisted state 显示，但不能在 persisted projection 已确认同一 identity 的位置后继续保有另一个副本，也不能把已经确认的 persisted activity 重新夺回临时位置。

### 2. 建立投影收敛不变量

本变更采用以下一般性不变量，而不是针对 retry 文本或特定 stop reason 去重：

1. **唯一位置**：一个能够由现有 Pi 数据安全关联的消息 identity 在 conversation projection 中最多拥有一个逻辑位置；同一 tool call/result 关联链中的一个 `toolCallId` 最多拥有一个 tool activity。不同 persisted entries 不得因 identity 推导碰撞而被错误合并。
2. **权威迁移**：persisted reconciliation 判断同一 identity 应位于另一个 visual turn 时，更新必须表现为从旧位置迁移到新位置，而不是复制。
3. **增量收敛**：对同一 active path 完成 reconciliation 后，增量投影与从空状态 full replacement 得到的持久化内容、顺序、状态和归属语义等价。
4. **幂等处理**：重复收到或重放已经由 persisted state 表示的事件，不增加 activity、不改变其权威位置。
5. **临时状态隔离**：optimistic prompt、尚未持久化的 streaming 内容、live-only notice 和 queued follow-up 可以暂时没有 persisted 对应项；它们不应削弱已持久化内容的不变量。
6. **视图连续性**：能够保留现有 view identity 和 disclosure state 时应保留；view identity 稳定性不能以保留重复内容或错误位置为代价。

“语义等价”不要求本地生成的 view ID、更新时间或仅存在于 live 阶段的 notice 完全相同。

### 3. 在现有责任边界内先完成治理

现有权威边界保持不变：

- session-entry state 负责 active path、leaf、append cursor 和是否需要 full reload；
- conversation projection 负责 visible entry、visual turn、activity、tool correlation，以及 live/persisted reconciliation；
- Webview 只渲染 Host 提供的有序 ViewModel，不承担跨 turn 去重或历史修复。

优先在 conversation projection 内明确 source authority、唯一位置和 relocation 语义。只有当这些不变量无法在当前模块内以清晰、可测试的方式维护时，才考虑把 persisted base 与 live overlay 拆成内部独立结构。当前证据不足以支持先做整体重写。

### 4. 区分 retry 信号与历史权威

Pi 的 `agent_end(willRetry: true)`、`auto_retry_start` 和后续 `agent_start` 可用于改善 live 状态，例如表达“正在重试”而不是短暂显示最终失败。

这些实时事件不属于 persisted session active path，不能单独决定 reload 后的消息归属。稳定历史必须能只依据 entries 重建。是否在本变更中同时改善 retry 期间的状态显示，属于待确认范围，不能与重复修复混为一项隐式改动。

## Behavior Contract

### Persisted authority

- settlement、history load、resume、tree navigation 或其他持久化刷新完成后，conversation 中的 persisted 内容和顺序必须服从 Pi active path。
- live activity 与 persisted message identity 匹配后，persisted projection 对该 activity 的最终位置拥有权威。
- active path 发生非追加变化时，继续使用 full replacement；本变更不放宽现有 active-path 完整性检查。

### Identity and location

- 同一个 assistant message 的 reasoning、response 和 tool-call parts 可以形成多个有序 activity，但这些 parts 共同拥有一个消息归属位置，不能分散在两个 visual turn 中。
- persisted reconciliation 可以替换 activity 对象、补全状态并迁移位置，但不得保留旧位置副本。
- tool result 继续通过 `toolCallId` 更新原 tool activity，不新增第二个 visible tool activity。
- identity correlation 不使用消息正文。现有由 Pi message 字段推导 identity 的兼容策略暂时保留，但测试必须覆盖生产环境中没有显式 message id、依赖 timestamp-derived identity 的路径。
- 当现有字段不能无歧义地关联 live message 与 persisted entry 时，incremental reconciliation 不得猜测或合并不同 persisted entries；应放弃该关联并进入可证明正确的 full replacement 或 persisted-only 投影路径。

### Incremental and full projection

对于相同 persisted active path：

- full replacement 和已经完成的 incremental reconciliation 必须具有相同的 visible persisted item 顺序；
- 每个 persisted message、tool call、compaction 和 boundary 的出现次数必须相同；
- visual turn 的 user ownership、activity ownership 和最终状态必须相同；
- repeated reconciliation 不得改变上述结果。

允许差异：

- 为保留 Webview disclosure state 而沿用的 live view ID；
- 仅存在于当前进程的 retry notice、optimistic prompt 或 queued follow-up；
- 不影响排序和行为的显示时间元数据。

### Retry and continuation

无论 visual turn 最终采用一个还是两个分组，下列行为已经确定：

- 一条成功 assistant message 只能显示一次。
- provider auto-retry 和 context-overflow compaction continuation 必须遵守相同的 identity、location 和 convergence 规则。
- retry 前的失败 assistant entry 可以保留并可检查；Pi 从工作上下文移除它不等于从 session history 删除。
- reload 前后成功消息的数量、顺序和归属语义保持稳定。

### History-load event replay

- history load 期间缓存的 live event 在 full replacement 后重放时，如果对应消息已经由 snapshot 表示，只能更新现有 activity，不能新增副本或将其移回非权威位置。
- snapshot 已包含 persisted compaction、随后重放无 entry id 的 buffered `compaction_end` 时，最终仍只能存在一个 compaction；后续没有新增 entry 的 refresh 也不能留下 live compaction 副本。
- 如果无法安全判定 event 与 snapshot 的对应关系，必须保持现有可见失败或重新加载边界，不能以正文匹配猜测。

### Failure behavior

- session-entry state 发现 parent chain 缺失、循环或 active path 无法建立时，继续报告可重试的 history failure。
- conversation projection 发现 identity/location 冲突且无法安全 reconciliation 时，不应静默保留冲突副本；应请求 full replacement 或报告可重试的 projection failure。
- history/projection failure 不得使仍可运行的 Pi child process 进入 failed。
- 日志和诊断不得包含 prompt、assistant 正文、tool output、图片、credentials 或未脱敏 proxy URL。

## Retry Visual-Turn Decision

### 待确认的产品语义

一次用户请求的第一次 attempt 失败、自动 retry 后成功，稳定界面应采用哪种分组仍未由用户确认。

**候选 A：一个 user-anchored visual turn（当前技术建议）**

```text
用户请求
└─ 一个 visual turn
   ├─ 失败 attempt、错误和 retry trace
   └─ 最终成功回复
最终状态：Worked；trace 可显示发生过错误
```

理由：用户只提交了一次请求，retry 是 Pi 内部 continuation；该语义也与 live 阶段当前的分组接近。要采用此方案，persisted entry projection 必须定义在没有新 user entry 时如何保持同一 visual turn，并由最后一个有效 terminal assistant 决定稳定状态。

**候选 B：失败与成功分为两个 visual turn**

```text
Failed visual turn：失败 attempt
Worked visual turn：最终成功回复
```

理由：该方案接近当前 full replacement 的实际分组，实施范围较小；代价是第二个 visual turn 可能没有 user message，并把 Pi 内部 retry 暴露为用户可见的 turn 边界。

无论选择哪种方案，都必须先满足唯一位置和增量收敛不变量。不能用跨 turn relocation 的实现便利替代产品语义选择。

### 相邻但独立的待确认项

retry backoff 期间是否应显示 `Retrying` 状态并避免短暂 `Failed` 闪现，需要单独确认。该体验可以消费 `willRetry` 实时信号，但不影响 persisted history 的权威规则，也不是消除重复回复的必要条件。

## Implementation Decisions

### 已确定

- persisted active path 继续作为持久化会话权威；不新增第二个历史数据源。
- reconciliation 必须按 identity 执行 update 或 relocation，禁止按消息正文做事后去重。
- identity 的位置记录必须支持安全删除旧位置，并在迁移后只保留一个当前位置。
- persisted reconciliation 有权迁移 live activity；后续 stale live replay 不得反向覆盖 persisted location authority。
- assistant message 的多个 activity parts 必须作为同一归属单元参与跨 visual turn 迁移，同时保持 part 顺序。
- tool identity map 必须与 assistant activity relocation 同步，不能留下指向旧 visual turn 的 location。
- full replacement 与 incremental reconciliation 的等价性通过归一化后的行为测试建立，不要求生产代码引入通用快照比较框架。
- Webview bridge 和 Svelte 不增加跨-turn 去重逻辑；冲突必须在 Host projection 边界解决。
- 生产环境 timestamp-derived assistant identity 必须进入测试矩阵；本变更不假设测试专用显式 id 总是存在。
- durable lifecycle 与 projection 保证在实现时同步更新现有模块 SPEC。

### 待 visual-turn 决策后确定

- persisted assistant 在 terminal stop reason 后是否立即关闭 visual turn。
- retry/compaction continuation 的最终状态由哪个消息或生命周期边界决定。
- 是否需要在 live 状态中显式建模 `willRetry`，以及该状态是否进入共享 ViewModel。

### 架构升级门槛

只有出现以下任一事实，才升级为 persisted base + live overlay 的内部结构重构：

- 当前单一 projection 无法明确表达 persisted location authority，必须依赖分散的调用顺序；
- relocation、stale replay 和 pending live state 的组合需要互相冲突的状态规则；
- 一般性不变量只能通过场景特判维持；
- 测试无法从公开 projection 行为证明增量与全量收敛。

若当前模块可以用单一位置所有权和少量明确状态满足全部 contract，则不增加新的抽象层。

## Compatibility and Migration

- 不迁移或重写已有 Pi session 文件。
- 已有 session 在重新加载时直接获得新的投影行为。
- Host-to-Webview 数据结构原则上保持兼容；如果 visual turn 状态需要新增 `retrying` 等可见状态，必须作为单独兼容决策审查。
- 已存在的 branch、compaction、custom message、tool result 和 queued follow-up 行为必须保持。
- 修复不得通过自动刷新 Webview 或强制 full reload 掩盖增量 projection 问题。

## Acceptance Criteria

### Core convergence

1. 对合法序列 `user → failed assistant → auto retry → successful assistant → settlement`，成功 assistant response 在整个 conversation projection 中只出现一次。
2. 对同一 persisted active path，增量 reconciliation 与从空状态 full replacement 的归一化结果相同，包括 persisted item 顺序、activity 归属、turn 状态和出现次数。
3. 对同一 entries 重复 reconciliation 不改变归一化结果。
4. 当 persisted reconciliation 把一个 message identity 定位到另一个 visual turn 时，旧 visual turn 不再包含该消息的任何 reasoning、response 或 tool-call activity part。
5. relocation 后再次重放或更新同一 message/tool，只更新权威位置上的 activity；旧 visual turn 不重新出现该 activity，整个公开 projection 中仍只有一个对应项。
6. 两个不同 persisted entries 即使发生 timestamp-derived identity 碰撞，也不会互相覆盖或被合并为一个 visible message；无法安全关联 live state 时进入 full replacement 或 persisted-only 路径。

### Lifecycle scenarios

7. provider auto-retry 满足 core convergence，并使用没有显式 assistant message id 的生产 identity 路径测试。
8. context overflow 导致 `compaction → continuation → successful assistant` 时，compaction 和成功回复均不重复，reload 前后结果稳定。
9. history snapshot 已包含某条消息、随后重放该消息 live event 时，不新增副本，也不改变 persisted-authoritative location。
10. history snapshot 已包含 persisted compaction、随后重放 buffered `compaction_end` 且增量 refresh 没有新 entry 时，公开 projection 中仍只有一个 compaction。
11. retry 最终失败后，incremental 与 full projection 具有相同的 persisted message 数量、顺序、归属和最终失败状态。
12. abort 与普通成功分别保持其既有 persisted message 数量、顺序和最终状态，且 incremental 与 full projection 等价。
13. toolUse/toolResult 循环继续只显示一个对应 tool activity；queued follow-up 继续按 Pi user-message FIFO promotion，不因本变更新增或重排 visual turn。
14. branch movement 继续触发 full replacement；普通 append 继续使用 incremental reconciliation。

### Chosen visual-turn behavior

15. 用户确认候选 A 或 B 后，自动化测试固定该分组，并验证 reload 前后 visual turn 数量、user ownership、最终状态和 activity 顺序一致。
16. 若纳入 retrying live 状态，retry backoff 期间不显示不可逆的最终失败状态，最终失败仍必须在 retry 结束后可见。

### Regression and verification

17. conversation projection 单元测试覆盖 multi-part assistant、tool call/result、compaction pairing、timestamp-derived identity 及其碰撞边界。
18. SessionRuntime 测试覆盖完整 retry 生命周期、history-load buffered replay 与 settle 后持久化刷新；fake Pi 至少有一个可重复的 retry fixture。
19. Webview 继续按 Host 顺序渲染；无需添加内容去重逻辑即可通过重复回复回归场景。
20. 相关聚焦测试、`pnpm check` 和 `pnpm build` 通过。
21. 使用原始故障模式手工验证：长 turn 经失败和成功 retry 后，GUI 中最终回复只出现一次；reload 不改变其数量与选定分组。

## Risks and Review Points

- Pi assistant message 没有始终可用的稳定显式 id，也没有已证明的 timestamp 全局唯一性；timestamp-derived identity 是当前 live/persisted correlation 的必要兼容路径，必须验证持久化稳定性并定义碰撞时的保守行为。
- 一个 assistant message 可以投影为多个 activity part；仅移动 response 会留下 reasoning 或 tool activity 分裂。
- history snapshot 与 buffered event 之间没有协议 watermark；authority 规则必须防止 stale live replay 重新取得位置所有权。
- 若选择一个 user-anchored visual turn，需要验证 Pi active path 中所有“连续 terminal assistant、期间没有新 user entry”的合法含义，避免把无关 extension command 错归到先前请求。
- `agent_end(willRetry)` 可改善 live UX，但它不是 persisted entry，不能成为 reload 分组的唯一证据。
- 只增加全局内容去重会隐藏错误位置，破坏消息顺序，并可能删除内容相同但身份不同的合法回复；该做法不接受。

## Glossary

- **Pi 执行 attempt**：一次由 `agent_start` 开始的底层模型执行。自动 retry 或某些 continuation 会开始新的 attempt，但不一定有新的 user message。
- **Pi session entry**：Pi 写入 session JSONL 的持久化节点，具有 entry id、parent id 和类型。它与 FrostPi visual turn 不是同一概念。
- **active path**：从 Pi 当前 `leafId` 沿 parent 关系回溯并反转得到的 root-to-leaf persisted entry 序列。
- **live event**：Pi RPC 在执行期间发出的实时事件，用于立即更新 streaming、tool、retry 和 compaction 状态。
- **live state**：尚未完全由 persisted entries 确认的临时 conversation projection 状态。
- **persisted state**：根据 Pi active path 投影得到的权威会话内容、顺序和归属。
- **visual turn**：FrostPi 为展示而构造的用户消息及其 assistant/tool activity 分组；不是 Pi session 中的原生节点。
- **identity**：FrostPi 用于判断 live activity 与 persisted message/tool 是否代表同一协议对象的稳定关联键；不能由消息正文推断。
- **location**：一个投影对象在 conversation 中所属 visual turn 及其 turn 内位置。
- **relocation**：同一 identity 的权威位置变化时，从旧 location 删除并在新 location 更新或插入的原子语义。
- **reconciliation**：将 provisional live state 与新取得的 persisted entries 对账，使 projection 收敛到权威 active path。
- **full replacement**：清空已有 projection，并仅根据完整 persisted active path 从头重建。
- **incremental reconciliation**：在已验证的新 active path 延续旧 leaf 时，只处理新追加 entries，并与现有 live state 对账。
- **semantic convergence**：对于同一 persisted active path，incremental reconciliation 与 full replacement 在 persisted 内容、顺序、归属、状态和数量上等价，允许 view ID 和 live-only 临时信息不同。
- **settlement**：Pi 发出 `agent_settled`，表示当前自动 retry、compaction continuation 和 queued continuation 已结束；FrostPi 随后刷新 persisted entries。
- **stale live replay**：history snapshot 已包含某项内容后，同一内容对应的先前缓存 live event 又被重放。
