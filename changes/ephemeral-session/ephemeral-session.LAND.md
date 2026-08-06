---
title: 临时对话（Ephemeral Session）落点说明
status: shaping
---

# 临时对话落点说明

本变更不引入新模块、不改变进程拓扑、不扩展 Pi RPC 协议。ephemeral 是会话记录上的一个**常驻标志**（创建时决定、终身不变），沿既有链路单向流动：Webview 创建入口 → registry 记录 → runtime 启动参数（`--no-session`）→ view model 展示（徽标/置灰/文案）。

现有 temporary session 机制（`#temporarySessionIds`）保留原样：它表达"未转正的暂态"，ephemeral 表达"永不落盘的常态"，两者互斥且不共享代码路径——ephemeral 不进入该集合，因此"首条 prompt 转正"、"切换即丢弃"、"fork 后暂态"等既有逻辑天然不触碰它。持久化过滤只需在 `#persist()` 出口加一个条件。

所有行为分支（重启拒绝、failed 后拒绝发消息、关闭确认、Fork 文案）都落在 `SessionRegistry` 既有决策点，UI 只做条件渲染。

## 文件落点

### Extension Host

```text
apps/vscode/src/extension/sessions/
├── SessionRegistry.ts                modify  +60–90/-10–20
│   创建入口接收 ephemeral；#persist() 双出口过滤；重启/自动启动守卫；关闭确认；Fork 文案。
│   createSession(ephemeral = false) → #createSessionInDirectory(directory, ephemeral)
│   #persist() 双出口：sessions 过滤追加 !record.ephemeral；activeSessionId 出口
│   追加 !record.ephemeral——**可选卫生修复**：使两个出口遵守同一不变量，
│   避免持久化内容自相矛盾（加载路径可自愈、无用户可见影响），
│   不做也不违反契约，测试不依赖
│   retrySession()：ephemeral 拒绝；restartAllSessions()：先过滤出可重启集合，
│   空集合直接提示"没有可重启的会话"，非空先 confirmRestart 再重启 + 跳过提示
│   #ensureRunning()：ephemeral 且 stopped/failed 拒绝发消息（防止静默重启丢对话）
│   confirmClose()：ephemeral 且存在包含用户 prompt 的 turn 时总是确认
│   forkMessage() 区分 ephemeral 文案
│   #handleRuntimeChange()：重建记录时保留 ephemeral 标志——**最高优先级实现点**：
│   每次 runSettled（每个 agent turn 结束、每次进程失败）都会重建记录，
│   漏掉该标志会使 ephemeral 在第一条回复后静默转正并被落盘
│
├── SessionRuntime.ts                 modify  +10–15/-0–5
│   构造接收 ephemeral（平铺参数，与现有风格一致）；#startInternal() 在 sessionFile 分支后
│   追加 --no-session；ephemeral 与 --session 天然互斥（ephemeral 记录永无 sessionFile）。
│
├── SessionViewState.ts               modify  +8–12/-0
│   构造参数加 ephemeral → 初始 isEphemeral 字段；运行中不变，无需 setter。
│
├── sessionTypes.ts                   modify  +2/-0
│   PersistedSessionRecord 增加 ephemeral?: boolean（仅内存，不落盘）。
│
└── session-lifecycle.SPEC.md         modify  +15–25/-0
    "Temporary sessions" 章节扩展 ephemeral 语义（与 DEV_SPEC 契约一致）。
```

`SessionPersistence.ts` 预计不修改：ephemeral 记录在 `#persist()` 被过滤，`isRecord()` 校验无需感知该字段。

### Bridge 与共享模型

```text
apps/vscode/src/shared/bridge/webviewToHost.ts    modify  +1/-1
    createSession 消息 schema 增加 ephemeral: boolean 可选字段（zod，向后兼容）。
apps/vscode/src/extension/webview-host/WebviewBridge.ts  modify  +2/-2
    createSession 分发时透传 ephemeral → registry.createSession(ephemeral)。
apps/vscode/src/shared/model/sessionViewModel.ts   modify  +3/-0
    SessionViewModel 与 SessionSummaryView 各加 isEphemeral: boolean。
```

### Webview

```text
apps/vscode/src/webview/features/sessions/
├── SessionHeader.svelte              modify  +40–60/-5–10
│   launcher 菜单底部 Temporary mode toggle（组件级 $state，默认关）；
│   New session 按钮文案按 toggle 切换为「New temporary session」；
│   创建动作 fire-and-forget（postToHost 无回调）：点击后立即复位 toggle，
│   创建被目录选择取消也不回滚（接受此取舍）；
│   Restart session 按钮 disabled + 置灰；Network & proxy / Question tool 的
│   restartRequired 文案在 ephemeral 时替换为"重启不可用（临时对话不保存）"；
│   标题旁「临时」徽标。样式走组件 scoped style（AGENTS.md CSS 边界）。
│
├── SessionList.svelte                modify  +8–12/-0
│   列表项「临时」徽标；底部 New session 按钮复用 createSession，toggle 开启时
│   同样创建临时会话（行为一致，不单独处理）。
│
└── onboarding/OnboardingView.svelte  modify  +3–5/-0
    failed 分支的 Retry 按钮对 ephemeral 隐藏（用户可从会话列表关闭）——
    否则启动失败的临时对话会进入 onboarding 并展示注定被拒的 Retry。
```

`configureProxy.ts` 的 "Restart current"/"Restart all" 模态是既有旁路入口：对 ephemeral，"Restart current" 被 registry 拒绝（toast）、"Restart all" 走过滤逻辑，功能安全由 registry 守卫兜底，UI 文案不再单独处理（接受 restartRequired 对 ephemeral 永久为 true、由菜单文案遮盖）。

### 测试

```text
apps/vscode/test/unit/SessionRuntime.test.ts     modify  +20–30
    启动参数断言：ephemeral 含 --no-session 且不含 --session；普通会话不含 --no-session。
apps/vscode/test/unit/SessionRegistry.test.ts    modify  +60–90
    持久化过滤（sessions 数组；含首条 prompt/重命名后仍不落盘）；重启拒绝/全部跳过
    （含全跳提示）；failed 后 sendPrompt 拒绝；模拟重启后恢复不含 ephemeral 记录。
    （activeSessionId 出口断言为可选，不做也可。）
```

mock pi 脚本注意：`SessionRuntime.test.ts` 的 mock 已对无 `--session` 有守卫；`SessionRegistry.test.ts` 内联 fake-pi 的 3 处 `process.argv[process.argv.indexOf("--session") + 1]` 无守卫，无 `--session` 时会取到 argv[0]（node 路径）并污染 view.sessionFile——必须加 `indexOf >= 0` 守卫，否则掩盖"ephemeral 永无 sessionFile"不变量的回归。

## 跨模块规则

这些约束无法从单个文件重构出来，删除任何一条都会让实现者重新发明或破坏语义：

1. **ephemeral 永不转正**：标志创建时定、关闭时终；`sendPrompt()`/`rename()` 的转正逻辑只作用于 `#temporarySessionIds`，ephemeral 不在其中。
2. **ephemeral 永无 sessionFile**：Pi in-memory 模式 `get_state.sessionFile` 为 `undefined`，`applyState()` 只在 truthy 时赋值；任何流程不得给 ephemeral 记录注入 sessionFile。
3. **ephemeral 不可重启**：`#restartRuntime()` 路径（restartSession）、`restartAllSessions()`、`#ensureRunning()` 自动启动、`activateSession()` 的 stopped 自动启动，全部对 ephemeral 关闭；restartRequired 只能展示"不可用"文案，不能暗示可应用。
4. **ephemeral 不持久化**：`#persist()` 出口过滤（含 activeSessionId 第二出口），恢复/目录协调/`startOnOpen` 天然不感知。

## 假设与边界

- `--no-session` 追加在用户自定义 `piArguments` 之后；若用户参数含 `--session`，Pi 侧 `createSessionManager` 判定 `noSession` 优先（in-memory 分支先于 `--session` 分支），行为确定但 FrostPi 不主动清理用户参数——假设用户不会为 ephemeral 会话配置互斥参数。
- fork 按钮（消息上的 Fork 入口）不做 UI 门控，依赖 registry 的明确错误文案（与契约一致）。
- 创建 ephemeral 前仍会丢弃 active 的未转正 temporary 会话（现有行为保留，不涉及 ephemeral 自身）。

## 明确不做

- 不新增命令（无 `newEphemeralSession` 命令，用户已确认）。
- 不新增设置项（toggle 是 UI 状态，不持久化）。
- 不支持中途转正、不支持 Fork、不支持进程死后恢复。
- 不修改 Pi RPC 协议、不修改 `packages/pi-rpc`。
