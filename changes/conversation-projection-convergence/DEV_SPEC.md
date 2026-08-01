---
title: Conversation Projection Convergence
created: 2026-08-01
status: clarifying
terminology: ./TERMS.md
scope:
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/test/unit/**
  - /apps/vscode/test/e2e/**
---

# 会话投影收敛 Change Spec

本文术语遵循同目录 `TERMS.md`。面向用户的讨论优先使用其中定义的中文术语；源码事件名仅在需要对应协议时保留。

## 问题陈述

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

## 目标

- 让 live 投影在持久化 entries 到达后稳定收敛到权威会话状态。
- 保证同一个 Pi 消息或工具调用不会同时存在于多个投影位置。
- 保证增量 reconciliation 与 full replacement 对同一 persisted active path 产生语义等价的稳定会话。
- 覆盖 Pi 核心的自动重试、上下文溢出后的自动继续，以及历史加载期间的实时信号重放。
- 明确执行尝试、会话记录与用户回合的边界，避免用一个概念代替另一个概念。
- 保留用户请求的即时显示、流式回复、工具状态和展开/折叠状态等现有实时体验。

## 非目标

- 不修改 Pi session JSONL 格式、parent chain 或 Pi 自身的 retry 策略。
- 不让 FrostPi 截获或重写 Pi 的文件操作和 session 持久化。
- 不为 Pi 增加仅供 FrostPi 使用的新 RPC 消息类型。
- 不通过回复文本、错误文本或时间接近程度猜测两条消息是否相同。
- 不在缺乏必要性的情况下重写整个 SessionRuntime 或拆建通用事件存储框架。
- 不在本变更中重新设计分支导航、排队的后续请求或上下文压缩的用户界面。
- 不处理与本故障无关的中止后部分内容持久化差异；该行为需要独立需求与证据。
- 不把 `Retrying` 等纯通知性实时状态写入额外持久化存储，也不要求 reload 后恢复这些瞬时提示。
- 不保证重新解释缺少用户消息、可见自定义消息或来源信息的任意 Pi 扩展独立执行；但其已有会话记录仍不得被 FrostPi 重复、丢弃或重排。

## 核心方法

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

Pi 的 `agent_end(willRetry: true)`、`auto_retry_start` 和后续 `agent_start` 是 live retry 状态的权威信号。FrostPi 在 retry backoff 期间显示 `Retrying`，不把仍会自动继续的 attempt 呈现为最终 `Failed`。当前 Pi TUI 同样在 `auto_retry_start` 后显示专门的 retry indicator，并只在全部 retry 最终失败时显示额外失败提示。

这些实时信号不属于持久化会话记录，不能单独决定 reload 后的消息归属，也不需要在 reload 后恢复。稳定历史只依据会话记录重建；实时提示只负责当前运行过程。两者分别建立行为测试，不新增额外持久化机制。

## 行为契约

### 会话记录的权威

- settlement、history load、resume、tree navigation 或其他持久化刷新完成后，conversation 中的 persisted 内容和顺序必须服从 Pi active path。
- live activity 与 persisted message identity 匹配后，persisted projection 对该 activity 的最终位置拥有权威。
- active path 发生非追加变化时，继续使用 full replacement；本变更不放宽现有 active-path 完整性检查。

### 消息身份与位置

- 同一个 assistant message 的 reasoning、response 和 tool-call parts 可以形成多个有序 activity，但这些 parts 共同拥有一个消息归属位置，不能分散在两个 visual turn 中。
- persisted reconciliation 可以替换 activity 对象、补全状态并迁移位置，但不得保留旧位置副本。
- tool result 继续通过 `toolCallId` 更新原 tool activity，不新增第二个 visible tool activity。
- identity correlation 不使用消息正文。现有由 Pi message 字段推导 identity 的兼容策略暂时保留，但测试必须覆盖生产环境中没有显式 message id、依赖 timestamp-derived identity 的路径。
- 当现有字段不能无歧义地关联 live message 与 persisted entry 时，incremental reconciliation 不得猜测或合并不同 persisted entries；应放弃该关联并进入可证明正确的 full replacement 或 persisted-only 投影路径。

### 增量对账与全量重建

对于相同 persisted active path：

- full replacement 和已经完成的 incremental reconciliation 必须具有相同的 visible persisted item 顺序；
- 每个 persisted message、tool call、compaction 和 boundary 的出现次数必须相同；
- visual turn 的 user ownership、activity ownership 和最终状态必须相同；
- repeated reconciliation 不得改变上述结果。

允许差异：

- 为保留 Webview disclosure state 而沿用的 live view ID；
- 仅存在于当前进程的 retry notice、optimistic prompt 或 queued follow-up；
- 不影响排序和行为的显示时间元数据。

### 自动重试与自动继续

- 一次 user message 开启一个 user-anchored visual turn。该请求引发的 provider auto-retry 和 context-overflow compaction continuation 均留在这个 visual turn，不能因新的内部 attempt 拆出第二个 turn。
- retry backoff 期间显示 `Retrying`，该 visual turn 仍是活动状态；只有 Pi 不再继续且最终结果为错误时才显示最终 `Failed`。
- retry 最终成功时，visual turn 状态为 `Worked`，成功 assistant message 只显示一次。
- retry 前的失败 assistant entry、错误和 retry notice 保留在默认折叠的 trace 中；正常折叠状态只展示最终成功回复，展开 trace 后可以检查失败 attempt 的部分内容和错误。
- provider auto-retry 和 context-overflow compaction continuation 必须遵守相同的 identity、location 和 convergence 规则。
- Pi 从工作上下文移除失败 assistant 不等于从 session history 删除。
- reload 前后保持同一个 user-anchored visual turn、相同的最终状态、成功消息数量和 activity 顺序。

### 责任范围

- FrostPi 对 Pi 核心产生的正常用户请求、自动重试、上下文压缩后自动继续、工具循环和后续用户消息提供稳定用户回合保证。
- Pi 扩展通过正常 user message 或 displayable custom message 留下边界时，FrostPi 按这些会话记录投影。
- Pi 扩展若在没有任何可持久化来源信息的情况下独立发起 assistant 执行，FrostPi 不承诺 reload 后还原其真实起因或精确用户回合归属。
- 上述边界只放宽“起因和用户回合归属”的解释责任，不放宽核心消息完整性：FrostPi 仍不得重复、丢弃或重排 Pi 已持久化的消息。
- 本变更不修改 Pi 会话格式，也不建立 FrostPi 私有关系表来补记来源。

### 历史加载期间的实时信号重放

- history load 期间缓存的 live event 在 full replacement 后重放时，如果对应消息已经由 snapshot 表示，只能更新现有 activity，不能新增副本或将其移回非权威位置。
- snapshot 已包含 persisted compaction、随后重放无 entry id 的 buffered `compaction_end` 时，最终仍只能存在一个 compaction；后续没有新增 entry 的 refresh 也不能留下 live compaction 副本。
- 如果无法安全判定 event 与 snapshot 的对应关系，必须保持现有可见失败或重新加载边界，不能以正文匹配猜测。

### 失败行为

- session-entry state 发现 parent chain 缺失、循环或 active path 无法建立时，继续报告可重试的 history failure。
- conversation projection 发现 identity/location 冲突且无法安全 reconciliation 时，不应静默保留冲突副本；应请求 full replacement 或报告可重试的 projection failure。
- history/projection failure 不得使仍可运行的 Pi child process 进入 failed。
- 日志和诊断不得包含 prompt、assistant 正文、tool output、图片、credentials 或未脱敏 proxy URL。

## 自动重试的用户回合语义

### 已确认的产品语义

一次用户请求经历任意次数内部 retry 后，始终表现为一个 user-anchored visual turn：

```text
用户请求
└─ 一个 visual turn
   ├─ trace：失败 attempt、错误和 retry notice
   └─ reply：最终成功回复
最终成功：Worked
全部 retry 失败：Failed
```

正常折叠状态只展示最终回复；失败 attempt 已生成的部分回复与错误保留在可展开 trace 中。该行为避免把 Pi 内部 attempt 暴露为没有新 user message 的独立 turn。

retry backoff 期间显示 `Retrying`，不先显示不可逆的最终 `Failed`。这一点与当前 Pi TUI 的 retry indicator 和“仅最终失败才额外报错”的行为一致。

### 优先级

最终稳定投影的正确性是核心要求：最终回复只出现一次、只存在一个 visual turn、reload 前后语义一致。live 过程同样采用 `Retrying` 语义，但技术方案应优先复用现有事件和状态；不能为了动画级无闪烁引入延迟队列或新的跨模块状态机，除非后续证据表明现有事件处理无法达到可接受结果。

## 技术决策

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

### 待技术方案确定

- 历史投影如何用一个明确规则识别 Pi 核心的自动重试与上下文压缩后自动继续；该规则无需解释缺失来源信息的任意 Pi 扩展独立执行。
- 临时界面状态如何利用 `willRetry` 与 `auto_retry_*` 表达 `Retrying`，以及是否只需保持现有运行状态并增加提示，还是确实需要共享 ViewModel 状态。
- 在 `message_end(error)` 早于 `agent_end(willRetry)` 的事件顺序下，如何以最低复杂度避免或缩短错误的最终 `Failed` 呈现。

### 架构升级门槛

只有出现以下任一事实，才升级为 persisted base + live overlay 的内部结构重构：

- 当前单一 projection 无法明确表达 persisted location authority，必须依赖分散的调用顺序；
- relocation、stale replay 和 pending live state 的组合需要互相冲突的状态规则；
- 一般性不变量只能通过场景特判维持；
- 测试无法从公开 projection 行为证明增量与全量收敛。

若当前模块可以用单一位置所有权和少量明确状态满足全部 contract，则不增加新的抽象层。

## 兼容与迁移

- 不迁移或重写已有 Pi session 文件。
- 已有 session 在重新加载时直接获得新的投影行为。
- Host-to-Webview 数据结构原则上保持兼容；如果 visual turn 状态需要新增 `retrying` 等可见状态，必须作为单独兼容决策审查。
- 已存在的 branch、compaction、custom message、tool result 和 queued follow-up 行为必须保持。
- 修复不得通过自动刷新 Webview 或强制 full reload 掩盖增量 projection 问题。

## 验收标准

### 核心收敛

1. 对合法序列 `user → failed assistant → auto retry → successful assistant → settlement`，成功 assistant response 在整个 conversation projection 中只出现一次。
2. 对同一 persisted active path，增量 reconciliation 与从空状态 full replacement 的归一化结果相同，包括 persisted item 顺序、activity 归属、turn 状态和出现次数。
3. 对同一 entries 重复 reconciliation 不改变归一化结果。
4. 当 persisted reconciliation 把一个 message identity 定位到另一个 visual turn 时，旧 visual turn 不再包含该消息的任何 reasoning、response 或 tool-call activity part。
5. relocation 后再次重放或更新同一 message/tool，只更新权威位置上的 activity；旧 visual turn 不重新出现该 activity，整个公开 projection 中仍只有一个对应项。
6. 两个不同 persisted entries 即使发生 timestamp-derived identity 碰撞，也不会互相覆盖或被合并为一个 visible message；无法安全关联 live state 时进入 full replacement 或 persisted-only 路径。

### 生命周期场景

7. provider auto-retry 满足 core convergence，并使用没有显式 assistant message id 的生产 identity 路径测试。
8. context overflow 导致 `compaction → continuation → successful assistant` 时，compaction 和成功回复均不重复，reload 前后结果稳定。
9. history snapshot 已包含某条消息、随后重放该消息 live event 时，不新增副本，也不改变 persisted-authoritative location。
10. history snapshot 已包含 persisted compaction、随后重放 buffered `compaction_end` 且增量 refresh 没有新 entry 时，公开 projection 中仍只有一个 compaction。
11. retry 最终失败后，incremental 与 full projection 具有相同的 persisted message 数量、顺序、归属和最终失败状态。
12. abort 与普通成功分别保持其既有 persisted message 数量、顺序和最终状态，且 incremental 与 full projection 等价。
13. toolUse/toolResult 循环继续只显示一个对应 tool activity；queued follow-up 继续按 Pi user-message FIFO promotion，不因本变更新增或重排 visual turn。
14. branch movement 继续触发 full replacement；普通 append 继续使用 incremental reconciliation。
15. 对缺少持久化来源信息的 Pi 扩展独立执行，不要求 reload 后还原其真实起因；测试仍断言其 persisted messages 不重复、不丢失且保持当前路径顺序。

### 已确认的用户回合行为

16. 一次 user message 经一次或多次 retry 后最终成功，只产生一个 user-anchored visual turn；其状态为 `Worked`，失败 attempt 位于 trace，最终成功回复只出现一次。
17. 同一 session reload 后仍保持一个 visual turn，并保持相同的 user ownership、最终状态和 activity 顺序；纯通知性 retry 状态无需恢复。
18. retry backoff 期间显示 `Retrying`，不把仍会自动继续的 attempt 稳定呈现为最终 `Failed`；全部 retry 最终失败后必须显示 `Failed`。
19. 默认折叠状态只展示最终成功回复；展开 trace 可以看到失败 attempt 的部分内容、错误和 retry notice。

### 回归与验证

20. conversation projection 单元测试覆盖 multi-part assistant、tool call/result、compaction pairing、timestamp-derived identity 及其碰撞边界。
21. SessionRuntime 测试覆盖完整 retry 生命周期、history-load buffered replay 与 settle 后持久化刷新；fake Pi 至少有一个可重复的 retry fixture。
22. Webview 继续按 Host 顺序渲染；无需添加内容去重逻辑即可通过重复回复回归场景。
23. 相关聚焦测试、`pnpm check` 和 `pnpm build` 通过。
24. 使用原始故障模式手工验证：长 turn 经失败和成功 retry 后，GUI 中最终回复只出现一次；reload 不改变其数量与 visual-turn 分组。

## 风险与审查点

- Pi assistant message 没有始终可用的稳定显式 id，也没有已证明的 timestamp 全局唯一性；timestamp-derived identity 是当前 live/persisted correlation 的必要兼容路径，必须验证持久化稳定性并定义碰撞时的保守行为。
- 一个 assistant message 可以投影为多个 activity part；仅移动 response 会留下 reasoning 或 tool activity 分裂。
- history snapshot 与 buffered event 之间没有协议 watermark；authority 规则必须防止 stale live replay 重新取得位置所有权。
- user-anchored visual turn 只对已验证的 Pi 核心自动继续路径提供精确分组；不能把该规则表述成对任意 Pi 扩展执行起因的普遍解释。
- `agent_end(willRetry)` 是实时重试体验的有效信号，但它不是会话记录，不能成为 reload 分组的唯一证据，也无需额外持久化。
- 只增加全局内容去重会隐藏错误位置，破坏消息顺序，并可能删除内容相同但身份不同的合法回复；该做法不接受。

## 术语表

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
