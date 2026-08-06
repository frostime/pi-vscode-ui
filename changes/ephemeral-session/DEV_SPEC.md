---
title: 临时对话（Ephemeral Session）
created: 2026-08-01
status: clarified
---

# 问题陈述

FrostPi 中每个会话都会持久化：Pi 把对话写入 `~/.pi/agent/sessions/*.jsonl`，FrostPi 把会话记录写入 VS Code 全局状态。用户有时只需要一次性的"用完即走"对话（提问、试错、临时调查），不希望留下任何痕迹或占用会话目录。

现有机制无法满足：

- 新会话在收到第一条 prompt 后立即"转正"：Pi 开始写 JSONL，FrostPi 开始持久化记录，此后会出现在恢复列表中。
- 没有入口让用户选择"这个对话不保存"。关闭后重新打开 VS Code，对话仍在，需要手动删除。

目标：提供**临时对话**——以 `--no-session` 启动的会话，Pi 不写 JSONL，FrostPi 不持久化记录，VS Code 退出后一切消失。

# 核心方法

在会话创建时由用户显式选择临时模式，该选择决定 Pi 进程的启动参数：

```text
Temporary mode 开关（UI）
  -> 新建会话记录标记 ephemeral（仅内存，不持久化）
  -> SessionRuntime 启动参数追加 --no-session
  -> Pi 使用 in-memory SessionManager：sessionFile 恒为 undefined
```

复用现有 temporary session 的持久化过滤模式（`#temporarySessionIds` 从 `#persist()` 中排除记录），但**ephemeral 永不转正**：首条 prompt 与重命名都不会让它变为持久化会话。

# 行为契约

## 创建入口

- SessionHeader 的 launcher 菜单底部提供 `Temporary mode` 开关（UI 状态，不持久化，默认关闭）。
- 开关开启时，"New session" 按钮文案变为「New temporary session」，点击后创建临时对话；关闭时行为与现在完全一致。
- **新建一个临时会话后开关自动复位**（防误操作：用户不会在忘记开关还开着时创建重要会话）。
- 不新增命令面板命令。
- 临时对话同样走工作目录选择流程（多根/worktree 逻辑不变）。

## 生命周期

- 临时对话保留到**手动关闭**或 **VS Code 退出**。切换/新建/恢复其他会话时不会自动丢弃（与现有 temporary session 的"切换即丢弃"不同，因为临时对话可能已有真实内容）。
- 临时对话不写入 FrostPi 持久化记录，也不写入 Pi session JSONL；VS Code 重启后不存在于任何恢复入口（恢复列表、catalog、startOnOpen）。
- 首条 prompt、重命名、`/name` 均不会使其"转正"。

## 重启语义（禁用）

临时对话的进程一旦停止，对话即永久丢失，因此所有重启路径对临时对话关闭：

- `frostpi.restartSession`：拒绝，提示"临时对话不支持重启"。
- `frostpi.restartAllSessions`：跳过临时对话，仅重启普通会话，并 toast 提示"已跳过 N 个临时会话"；若所有会话均为临时对话，提示"没有可重启的会话"。
- 代理/网络/Question Tool 配置变更产生的 `restartRequired`：对临时对话显示"重启不可用（临时对话不保存）"之类的说明文案，无法应用变更。
- 进程 failed/stopped 后：无法重试，只能关闭会话；**对已死进程的临时对话发消息同样拒绝并提示（`#ensureRunning` 的自动重启路径对临时对话不生效）**，绝不静默重启。
- UI 上 "Restart session" 按钮对临时对话置灰；onboarding 视图 failed 分支的 Retry 按钮对临时对话隐藏（用户可从会话列表关闭）；configureProxy 弹窗的 "Restart current" 对临时对话被拒绝（toast），"Restart all" 走跳过逻辑。

## 关闭确认

- 临时对话关闭时，若对话非空，总是弹确认框，文案说明"临时对话内容将丢失且不可恢复"（现有确认框只在 streaming / 有 pending UI 时弹出，其文案"Persisted Pi history is retained"对临时对话不成立）。
- "对话非空"定义为：**存在包含用户 prompt 的 turn**（与"从未发送 prompt"的边界对齐，不含纯 error notice 等非用户内容）。
- 对话为空的临时对话（从未发送 prompt）关闭无需确认。

## 功能边界

- **消息 Fork**：临时对话无 `sessionFile`，Fork 不可用，错误提示为明确的"临时对话不支持 Fork"（现有 "Wait for Pi to save this session" 对临时对话永远等不到，不适用）。
- **会话树导航**：不依赖 `sessionFile`，Pi 的 in-memory 会话同样支持 `get_entries`，树导航保持可用。
- `/resume`、`/compact`、`/export` 等 Pi 侧命令：按 Pi in-memory 模式原有语义工作（可导出当前内存对话），FrostPi 不做额外处理。

## 边界（不支持）

- 临时对话**不支持中途转正**为普通会话：需要保存的对话请用普通会话重新创建。

## UI 展示

- 会话列表（SessionList）与会话头部（SessionHeader）为临时对话显示「临时」徽标。
- 创建时 toggle 自动复位后，按钮文案恢复为 "New session"。
- 状态文本保持现有语义；`restartRequired` 展示如上文替换为不可用说明。

# 技术决策

- 会话记录（内存态 `PersistedSessionRecord`）增加 `ephemeral` 标志；`#persist()` 过滤带该标志的记录，与现有 `#temporarySessionIds` 的过滤机制并列。
- `SessionRuntime` 启动参数拼装处：ephemeral 时追加 `--no-session`；不传 `--session`（临时对话无 sessionFile，Pi 侧 `get_state` 返回 `sessionFile: undefined`，现有代码已能处理）。
- 临时对话**不进入** `#temporarySessionIds`：其"切换即丢弃"与"首条 prompt 转正"逻辑对临时对话均不生效。
- View 模型（`SessionViewModel` / `SessionSummaryView`）增加 `isEphemeral` 字段，从 registry 流转到 Webview，驱动徽标、按钮置灰与确认文案。
- Registry 的重启入口（单个重启、全部重启、failed 重试）对 ephemeral 分支处理；`restartRequired` 状态展示需要区分 ephemeral 与普通会话。
- 现有 `session-lifecycle.SPEC.md` 的 "Temporary sessions" 章节扩展出 ephemeral 语义，避免两个概念混淆。

# 验收标准

## 自动化检查

- 单测：ephemeral 会话启动参数包含 `--no-session`，普通会话不含。
- 单测：`#persist()` 输出的 sessions 数组不包含 ephemeral 记录（首条 prompt / 重命名后仍被排除）；activeSessionId 出口是否指向 ephemeral 为可选断言（见 LAND 的可选卫生修复）。
- 单测：`restartSession` 对 ephemeral 拒绝；`restartAllSessions` 跳过 ephemeral 且不报错（含"全部被跳过"时提示）。
- 单测：ephemeral 进程 failed 后 `sendPrompt` 拒绝且不触发自动重启（普通会话行为不变）。
- 单测：临时对话不在恢复/快照的持久化数据中出现（模拟 VS Code 重启后重新 load）。
- 全量：`pnpm check`、`pnpm build` 通过。

## 用户检查

- 开启 Temporary mode 后点 New session：新会话带「临时」徽标；发送多轮对话后，关闭 VS Code 再打开，恢复列表与 catalog 中均无该会话。
- 临时对话中切换/新建/恢复其他会话，临时对话仍在会话列表中，内容不丢。
- 临时对话的 "Restart session" 按钮置灰；`restartAllSessions` 不重启它；改代理配置后提示"重启不可用"而非 "restart required"。
- 关闭带内容的临时对话会弹"内容将丢失"确认框。
- 普通会话行为完全不变（无回归）。

# 术语表

| 术语 | 定义 |
|---|---|
| 临时对话 / ephemeral session | 本功能：以 `--no-session` 启动、全程不落盘的会话；进程停止或 VS Code 退出后内容永久消失 |
| temporary session（现有） | FrostPi 现有概念：新会话未收到首条 prompt 前的状态；FrostPi 不持久化、切换会话时自动丢弃、首条 prompt 或重命名后转正 |
| 转正 | temporary session 变为普通持久化会话的时点（首条非空 prompt 或重命名） |
| 普通会话 / persisted session | 现有默认会话：Pi 写 JSONL、FrostPi 持久化记录、可恢复 |
| sessionFile | Pi 会话 JSONL 文件路径；ephemeral 模式下恒为 undefined |
| restartRequired | 配置变更（代理/Question Tool）后需重启进程才能生效的标记 |
