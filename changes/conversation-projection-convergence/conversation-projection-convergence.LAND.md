---
title: 会话投影收敛落点说明
status: implemented
implemented: 2026-08-01
---

# 会话投影收敛落点说明

> **Implemented.** 本文件保留为已批准落点的历史记录；实际合同以模块 SPEC 和代码为准，不再继续维护。

本变更保留 `ConversationProjection` 的公开接口、`SessionRuntime` 调用方式和 Host-Webview 数据结构。`ConversationProjection` 继续解释 Pi 生命周期并决定用户回合归属；新增一个 Host 内部的 `ConversationItemStore`，集中拥有有序会话项、消息位置、工具位置和持久化接管状态，使“从旧位置删除并写入新位置”成为一次原子操作。自动重试通过用户回合的自动继续锚点留在同一回合，`Retrying` 复用现有 running 状态与 notice，不建立第二套历史模型或新的持久化机制。

## 文件落点

### Host 会话投影

```text
apps/vscode/src/extension/conversation/
├── ConversationProjection.ts             modify  +120–180/-160–230
│   Pi 事件、会话记录分组、自动继续锚点、关联冲突与 reload 决策。
├── ConversationItemStore.ts              create  ~180–260 lines
│   有序会话项、消息/工具唯一位置、原子迁移和持久化位置接管。
├── conversation-projection.SPEC.md        modify  +35–55/-5–15
│   固化用户回合分组、位置权威、冲突恢复和迟到实时信号规则。
└── messageAssembler.ts                    existing, no change expected
    保持内容到 ViewModel block/tool 的纯转换职责。
```

### Webview 工作记录折叠

```text
apps/vscode/src/webview/features/conversation/
└── collapseTurnTrace.ts                   modify  +20–35/-5–15
    将失败 assistant activity 与 retry notice 纳入可折叠工作记录和错误计数。
```

`AgentTurn.svelte`、shared `conversationModel.ts` 和 Host-Webview bridge 预计不修改；`Retrying` 不新增共享状态枚举。

### 生命周期规格

```text
apps/vscode/src/extension/sessions/
└── session-lifecycle.SPEC.md               modify  +10–20/-2–8
    说明 `agent_end(willRetry)` 不终结用户回合，`agent_settled` 后刷新会话记录。
```

`SessionRuntime.ts` 的主要运行流程预计不修改。若 skeleton 或实现证明必须传入新的跨模块生命周期状态，停止并重新审查边界。

### 验证

```text
apps/vscode/test/unit/
├── ConversationItemStore.test.ts          create  ~120–180 lines
│   原子迁移、持久化接管、工具位置同步和关联冲突行为。
├── ConversationProjection.test.ts         modify  +200–280/-0–20
│   自动重试、压缩后继续、无显式 ID、增量/全量收敛和迟到事件。
├── SessionRuntime.test.ts                 modify  +120–180/-0–20
│   完整 retry 生命周期、settle 刷新和历史加载事件重放。
└── collapseTurnTrace.test.ts              modify  +30–50/-0–10
    默认折叠只显示最终回复，展开后保留失败尝试与 retry notice。

apps/vscode/test/e2e/
└── fake-pi.cjs                            modify  +60–100/-0–10
    可重复的失败、自动重试、成功和 persisted entries fixture。
```

### Change 工件

```text
changes/conversation-projection-convergence/
├── DEV_SPEC.md                            modify  +30–45/-15–30
│   将已确认的代码责任、迁移顺序和 YAGNI 边界写入技术决策。
└── conversation-projection-convergence.LAND.md
    Pass 0 落点审查说明；确认后由工作树取代。
```

## 跨模块合同

- `ConversationProjection` 的公开构造器、`read()`、`replaceEntries()`、`reconcileEntries()`、`applyEvent()`、prompt/follow-up API 保持兼容。
- `ConversationItemStore` 是 extension Host 内部模块，不进入 shared model，不跨 Webview bridge。
- `SessionEntryState` 继续独占 Pi 当前路径、leaf、cursor 与 append/reload 判断。
- `ConversationProjection` 独占以下语义决策：新 user 开启回合；Pi 核心自动重试和 overflow compaction 后继续原回合；关联歧义要求 reload；live retry 何时仍为 running。
- `ConversationItemStore` 独占以下物理状态：`ConversationItemView[]`、message/tool location、同一消息的全部 activity parts、persisted owner 标记。调用方不能直接维护平行 location map。
- persisted assistant 的最终身份使用 entry ID；live message ID/timestamp 只作为关联线索。关联线索碰撞不得合并两个 persisted entries。
- `ConversationItemStore` 检测无法安全完成的关联时返回显式冲突；`ConversationProjection.reconcileEntries()` 把它转换为现有 `"reload"` 结果，不能部分写入后再失败。
- compaction 使用 `firstKeptEntryId` 关联 live 与 persisted 对象；summary 正文不参与身份判断。增量 entry 缺失该字段时要求 full replacement，清除 provisional compaction 后按 entry ID 独立投影。
- persisted 位置接管后，迟到 live message/compaction event 只能成为无操作或更新同一权威位置，不能创建 orphan 副本。
- shared `AgentTurnStatus` 保持 `running | completed | aborted | error`；retry backoff 通过 `running` + notice 表达。

## 实现结果

`ConversationProjection` 已删除位置 map 与直接 activity 迁移，保留生命周期和用户回合分组；`ConversationItemStore` 已接管物理状态和四个受控操作。内容转换、图片校验、queued follow-up 和 branch-control 行为保持原有边界。

## 明确不落地

- 不创建 persisted-base/live-overlay 双状态模型。
- 不创建通用 reducer/event store/replay framework。
- 不修改 Pi RPC、session JSONL、shared ViewModel 或 FrostPi metadata。
- 不让 Webview 按正文或时间去重。
- 不为任意无来源 Pi extension 执行维护私有因果关系。
