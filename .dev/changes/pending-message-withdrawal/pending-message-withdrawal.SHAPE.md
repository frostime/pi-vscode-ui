---
status: locked
---

# Pending message recovery — SHAPE

本次交付是一个完整的 **Restore all → 后端取回 → 输入框回填** 功能，覆盖 Steer、Queue 和 Pi、OMP，而不是单独增加 RPC 方法或气泡按钮。新增专用的 `QueuedPromptRecovery` class，集中取回操作的状态、协调和运行时差异；`SessionRuntime` 只负责创建/释放、提交确认接入和动作转发，会话投影与草稿仍留在原有所有者中。

**预计约 24–26 个生产源码文件，生产代码净新增约 550–900 行，模块契约约新增/调整 40–80 行。** 恢复主逻辑集中在新 class（约 140–220 行），`SessionRuntime` 接线约新增 20–40 行，前端入口约 70–130 行。测试只根据第 7 节的语义场景选择，不设测试行数或覆盖率目标。本轮按用户授权收窄 Pi 的责任：真实对话必须准确，竞态中的气泡不要求精确同步；不新增“待确认”状态或补偿队列。收敛后的最小路径已回放既有四组真实时序；用户已批准按本规范实施。本文现锁定为实现前预测，执行进度与验证结果记录在同目录 PLAN 中。

## 1. 目标与当前证据

已确认的第一版范围：

- 一次性取回两个待处理队列，不做逐条按钮。
- 不停止当前 agent run，不清空后重发其他消息。
- Pi 提供 TUI 同级的尽力取回文本，提示已开始投递的内容仍可能执行。
- OMP 只恢复后端确认移除的内容，保留未移除消息的正常运行路径。
- 保留当前草稿，不自动发送。Pi 的待处理内容含图片时禁用批量取回；OMP 使用实际返回的图片，不猜测补图。
- 已确认抽出每会话独立的 `QueuedPromptRecovery` class，不再将恢复流程堆在 `SessionRuntime`，也不叠加 Hook/Manager。
- 原型中的气泡组顶部入口、文本前置空行合并及反馈方式已获用户确认。本轮方案复用该反馈区域说明 Pi 的残余投递风险，不增加“待确认”状态。
- 新增轻量规避：压缩时禁用取回，前后端一致；不因此长期禁止编辑或等待整轮 agent 结束。

依据：`.dev/changes/pending-message-withdrawal/RESEARCH.md` 记录 Pi 1.4.0 / OMP 18.12.6 的真实 RPC 实验；`prototype.html` 是模拟交互原型。两者都不是产品实现。Issue #10 首选逐条操作，但明确接受 withdraw-all 替代。

## 2. 空间 Diff 树

估算中的 `local edit` 表示保留现有主体逻辑；`additive` 表示新增能力而非重写。区间用于识别形状偏移，不是行数配额。

```text
packages/pi-rpc/
├── src/PiRpcApi.ts                         modify +20–35/-0–5   additive
│   暴露 Pi clear_queue 和显式 OMP remove_queued_message 两个原始操作；不做相互模拟
└── src/protocol/rpcTypes.ts                modify +15–25/-0     additive
    两种原始结果的类型；保留 OMP removed / images / imagesDropped
    不为这两个薄 API 包装单独增加转发测试；实际命令语义随功能路径验证

apps/pi-client/src/shared/
├── model/queuedPromptRecoveryModel.ts      create +30–50        additive
│   恢复可用性、结果质量、已恢复内容和明确的部分失败原因；纯可序列化契约
├── model/sessionViewModel.ts               modify +3–6/-0      local edit
│   投影恢复状态，不让 UI 自己判断运行时种类
├── model/composerDraftModel.ts             modify +15–25/-0    additive
│   纯内容合并规则：前置文本、保留原草稿、合并附件；供 Host/UI 共用
├── bridge/webviewToHost.ts                 modify +8–15/-0     local edit
│   restoreQueuedPrompts 的有界关联请求；浏览器不提供待删除消息正文、队列或 Pi 命令
├── bridge/hostToWebview.ts                 modify +10–20/-0    additive
│   同一 requestId/sessionId 的恢复结果；区分 Host 已应用与 Webview 待合并
└── bridge/bridgeVersion.ts                 modify +1/-1        local edit
    新增必需的 SessionViewModel 字段后升级 bridge 版本，避免旧 UI 误读

apps/pi-client/src/core/
├── configuration/runtimeCompatibility.ts  modify +3–8/-0      local edit
│   明确声明本次新增的产品能力；不引入通用运行时探测机制
├── sessions/QueuedPromptRecovery.ts        create +140–220      additive
│   专用 class：提交确认等待、取回互斥、Pi/OMP 执行、部分结果和过期结果处理
│   一个实例绑定一次 Pi 子进程生命周期；通过 Projection 的公开边界提交队列变化
├── sessions/SessionRuntime.ts              modify +20–40/-5–15 local edit
│   创建/释放实例、接入排队提交确认、转发 restoreQueuedPrompts、投影状态变化
│   不搬移整个 sendPrompt，不将普通 agent turn 或扩展命令执行纳入取回互斥
├── sessions/SessionViewState.ts            modify +5–12/-0–5   local edit
│   组装恢复状态的标量投影；不保存 class 的第二份 busy/生命周期状态
├── conversation/ConversationProjection.ts modify +40–100/-10–30 local edit
│   保留本地队列的既有记账；恢复后的真实用户内容独立投影，不借新气泡的正文/附件
│   模式随既有 settled/进程终止边界结束；不推断逐条队列身份，不重写持久化投影
└── attachments/normalizeImageAttachment.ts modify grouped +10–20/-0–5，若需转换入口
    复用现有 MIME/Base64/体积校验；不建立第二套附件验证规则

apps/pi-client/src/host/
├── SessionRegistry.ts                     modify +8–15/-0     local edit
│   按稳定 Session id 找到 Runtime；不改变 activeSessionId
└── bridge/
    ├── WebviewActionDispatcher.ts         modify +35–60/-0–5  additive
    │   既有授权后调用 Runtime；按草稿归属交付结果，不直接操作 Pi 队列
    ├── WebviewConnection.ts               modify +15–35/-0–5  additive
    │   恢复结果只发给来源；用捕获的 sessionId，不用 await 后的当前 sidebar session
    └── ComposerDraftCache.ts              modify +30–60/-0–5  additive
        Host-owned 草稿的前置合并；取回期间维持现有 tab→sidebar 草稿归属

apps/vscode/src/extension/webview-host/
└── SessionWebviewCoordinator.ts           modify +3–8/-0      local edit
    将待完成的 Host-owned 回填纳入现有草稿归属判断；不增加新的界面路由系统

apps/pi-client/src/ui/
├── features/conversation/ConversationView.svelte modify +20–35/-0–5 local edit
│   待处理组的 Restore all、处理中和禁用原因；只消费投影和回调
├── shell/SessionInteraction.svelte        modify +25–50/-0–5  additive
│   协调点击、关联结果、当前会话焦点及提示；不承担运行时差异
├── features/composer/Composer.svelte      modify +8–20/-0–5   local edit
│   取回期间禁止发送/新增附件；文本编辑不因取回被整体冻结
├── features/composer/composerDraftSync.ts modify +10–20/-0–5  local edit
│   合并最新的 Webview-local 草稿，沿既有 updateDraft 同步规则运行
├── features/composer/queuedPromptRecoveryStore.svelte.ts create +10–25 additive
│   来源 Webview 内的关联结果状态，复用 promptSubmissionStore 的简单模式
└── bridge/applyHostMessage.ts             modify +15–25/-0–5  local edit
    接入结果分发；Host 已应用的草稿不在 UI 再合并一次

apps/desktop/src/main/
└── publishDesktopEvent.ts                 modify +10–20/-0–5 local edit
    新恢复结果超过既有 32 MiB 桥接上限时，返回同 requestId 的明确部分结果/失败
    不让它退化成无关联 toast，使 UI 永久等待；不引入新的 IPC 分块协议

测试与契约（grouped，按第 7 节的语义分配，不按生产文件一一配套）：
├── apps/pi-client/test/unit/QueuedPromptRecovery.test.ts create grouped
│   在真实 Projection 上验证取回事务；RPC 是可控的外部边界
├── apps/pi-client/test/unit/ConversationProjection.test.ts modify grouped
│   迟到旧消息与新排队消息交错的既有失败反例
├── apps/pi-client/test/unit/{SessionRuntime,OmpSessionRuntime}.test.ts modify grouped
│   仅补实际接入/生命周期回归，不重复测试 class 的内部步骤
├── apps/pi-client/test/host/                              create/modify grouped
│   请求越权、最新草稿、tab 关闭交接和来源会话隔离
├── apps/pi-client/test/fixtures/                         modify grouped
│   只增加上述场景需要的可控 child 行为，不扩建通用 RPC 模拟框架
├── apps/vscode/test/unit/*.dom.test.ts                   create/modify grouped
│   实际入口点击、草稿和反馈；不 mock 掉被测组件
├── apps/desktop/test/                                   modify grouped
│   新结果超限时必须有同 requestId 的反馈，不悬挂等待
└── 相邻 SPEC / OMP supported surface                     modify grouped +40–80
    RPC SPEC、conversation-projection、composer、webview-bridge、OMP compatibility
```

**不预计修改：** `ClientHost`、`PiRpcConnection`、RPC dialect、现有 `OmpPromptCompatibility`、Pi 扩展、Pi/OMP 安装内容、会话持久化、设置生成器、VS Code panel 创建逻辑、Desktop renderer/native/Rust、打包或发布流程。只新增一个专用恢复 class，不再叠加 Hook、Manager 或通用队列框架；现有 OMP prompt/skill/完成事件解释继续由原模块负责。

这里与 #11 的 Desktop 范围不同：#11 没改 Desktop 专有源码；本次图片结果可能撞到现有 Desktop 桥接上限，预计只在其已有发布边界补一个有限适配，而不是开发独立 Desktop 功能。

## 3. 调用与依赖变化

下面箭头只表示调用/交付方向；省略未改的中间层和无关兄弟调用。

```text
ConversationView.svelte :: Restore all [NEW]
└──> SessionInteraction.svelte :: requestRecovery [NEW]
     └──> ... hostBridge / schema validation [KEEP]
          └──> WebviewActionDispatcher :: restoreQueuedPrompts [NEW]
               ├──> origin/session authorization [KEEP]
               └──> SessionRegistry :: restoreQueuedPrompts [NEW]
                    └──> SessionRuntime :: restoreQueuedPrompts [NEW，薄接线]
                         └──> QueuedPromptRecovery :: recoverAll [NEW，功能协调边界]
                              ├──> PiRpcApi :: clearQueue [NEW，Pi 原始语义]
                              └──> PiRpcApi :: removeOmpQueuedMessage [NEW，OMP 原始语义]
```

```text
QueuedPromptRecovery :: recoverAll [NEW]
├──> ConversationProjection :: recovery commit / late delivery handling [NEW，见阻塞项]
└──> ... SessionRuntime / Registry / Dispatcher [KEEP，返回结果]
     └──> WebviewConnection :: deliverRecovery [NEW]
          ├──> ComposerDraftCache :: prependContent [NEW，Host-owned]
          │    └──> ... draftReplacement / snapshot [KEEP]
          └──> restoreQueuedPromptsResult [NEW，Webview-local]
               └──> applyHostMessage / composerDraftSync :: prependContent [NEW]
                    └──> existing session draft / updateDraft [KEEP]
```

`QueuedPromptRecovery` 是本功能唯一的协调边界，不是新的队列。提交确认通过它的 admission 入口登记；子进程建立时创建实例，停止/替换时释放实例。Pi/OMP 的恢复差异只在这个产品层模块内处理，上层使用统一操作和结果，不接触运行时种类。

不出现 `clear_queue → OMP 多次移除` 的 dialect 映射。那不是等价的 wire 翻译：是否移除成功、哪些内容可恢复、部分失败和 UI 队列更新都依赖会话状态。统一接口仍保留 `certainty` 和警告，不能伪造两者拥有相同的撤回保证。

## 4. 关键边界草图

这些是待评审的结构签名，不是已经存在的代码。具体字段名可在锁定前调整，语义不能被悄悄缩减。

```ts
// shared/model/queuedPromptRecoveryModel.ts
interface QueuedPromptRecoveryView {
  state: "unavailable" | "ready" | "recovering";
  reason?: "session-unavailable" | "compacting" | "images-not-supported";
}

interface QueuedPromptRecoveryOutcome {
  certainty: "best-effort" | "confirmed";
  content: ComposerDraftContent; // 取回内容，不是已有草稿的旧快照
  recoveredCount: number;
  notRemovedCount: number;      // 不等价于“已消费”；不能据此捏造对话记录
  warnings: Array<"delivery-uncertain" | "not-removed" | "images-dropped" | "host-size-limit" | "request-failed">;
}

// core/sessions/QueuedPromptRecovery.ts
// Dependencies are finite owners, not the entire SessionRuntime or its private callbacks.
interface QueuedPromptRecoveryOptions {
  api: PiRpcApi;
  runtime: RuntimeCompatibility;
  conversation: ConversationProjection;
  readAvailability(): "ready" | "compacting" | "unavailable";
  getAttachmentLimits(): AttachmentLimitsView;
  onChange(): void;
}

declare class QueuedPromptRecovery {
  constructor(options: QueuedPromptRecoveryOptions);
  readonly view: QueuedPromptRecoveryView;
  admitQueuedPrompt(submit: () => Promise<void>): Promise<void>;
  recoverAll(): Promise<QueuedPromptRecoveryOutcome>;
  dispose(): void;
}

// SessionRuntime keeps the product entry and delegates to its current instance.
declare class SessionRuntime {
  restoreQueuedPrompts(): Promise<QueuedPromptRecoveryOutcome>;
  // ...
}

// Browser requests no message identities or queue rewrites.
interface RestoreQueuedPromptsRequest {
  type: "restoreQueuedPrompts";
  requestId: string;
  sessionId: string;
  draftImageCount: number; // 有界的容量前检输入，不授予队列/草稿解释权
}

// Result remains origin-correlated; content is omitted when Host already applied it.
type RestoreQueuedPromptsResult = {
  type: "restoreQueuedPromptsResult";
  requestId: string;
  sessionId: string;
} & (
  | { ok: true; draftTarget: "host-applied";
      outcome: Omit<QueuedPromptRecoveryOutcome, "content"> }
  | { ok: true; draftTarget: "webview-merge";
      outcome: QueuedPromptRecoveryOutcome }
  | { ok: false; error: string }
);
```

`certainty` 表示移除确认强度，不表示图片一定完整。`host-applied` 分支不再次传图或合并；只有 `webview-merge` 分支携带可应用的内容。OMP 批量中途失败但已有确认结果时，仍交付这些内容并标记 `request-failed`，不能用一个空的 `ok:false` 丢弃已取回部分。

`ComposerDraftCache` 增加的是这一次回填所需的短暂 Host 草稿归属，不是持久化恢复箱。普通 sidebar 仍使用 Webview-local 草稿，不因这项功能开始把所有编辑同步到 Host；普通 Webview 被销毁后的草稿恢复不升级为新的持久保证。

## 5. 跨文件护栏

### 操作与运行时

- `readAvailability` 只读取既有会话标量，不通过聚合的 `SessionRuntime.view` 递归读取恢复状态。UI 可用性是投影；真正执行前，恢复 class 仍检查压缩/进程可用性，不能只有前端禁用。
- `QueuedPromptRecovery` 自己持有 admission 集合、取回 busy 和 disposed 状态，`SessionRuntime` 不再镜像这些状态。一个实例只绑定一次子进程生命周期；释放它不等于调用 agent abort。
- `admitQueuedPrompt` 包裹排队提交的 RPC 接受过程，不包裹整个 `sendPrompt`、普通 agent turn 或扩展命令执行。`recoverAll` 等待此前登记的确认再抓取候选；阻止与同会话的新排队提交/重复取回交错，但不等待 agent turn，不阻塞其他 Session，不停止事件处理。
- class 通过 `ConversationProjection` 的公开操作提交队列变化，不取得持久化身份或事件渲染的所有权；它返回恢复内容，不读取/改写 Composer 草稿。
- 候选集合按“开始取回时的队列”冻结。OMP 只做有界次数的删除，不循环追赶不断新增的队列，不在未知结果后自动重试。中途失败也必须交付此前已确认的部分，不能回滚、重放或只抛错。
- Pi 结果表示取回的文本，不表示所有文本都已被可靠撤销；OMP 的 `removed:false` 不自动等价于已投递。
- 进程停止、重启或 Session 被移除后，旧进程的结果不得写入新 Runtime/Session。
- 不添加 abort、clear-and-requeue、提示词重放、模板重新展开、全局串行锁或运行时补丁。

### 投影与草稿

- 浏览器不因点击先乐观删除气泡；恢复协调由 `QueuedPromptRecovery` 负责，队列与对话的投影规则由 `ConversationProjection` 负责。Pi 迟到消息须以实际事件的正文和图片出现，不得借新气泡内容或持久 entry 身份冒充它；Pi 特殊竞态中的气泡记账允许偏差，不为此增加恢复机制。
- 持久身份仍来自 `get_entries` 的 entry id；禁止用文本、图片内容或时间戳相等建立新的身份规则。
- 回填使用完成时最新的草稿。Host-owned 草稿只能由 `ComposerDraftCache` 变更；Webview-local 草稿由现有 draftSync 路径合并，不能绕过 revision 或双写。
- 保留既有 tab 关闭/切换的 Host 草稿交接。来源 sidebar 选中其他 Session 后，回填仍指向原 Session，不抢焦点到无关会话。
- 合并后仍遵守现有图片数、单图大小和支持格式。发起前前检容量，等待期间不新增图片；不得通过 `slice()` 静默丢图。OMP 返回 `imagesDropped` 或 Host transport 无法携带图片时，要给出明确提示，不用本地同文消息的旧图片猜测补齐。
- 新结果不写入 Session JSONL、日志、浏览器持久存储或新的凭据/附件存储。

### 界面

- 按钮位于待处理消息组，Steer/Queue 共用一个入口；在 sidebar、editor tab 使用同一组件。没有待处理内容时不显示入口。
- 正在取回时展示忙状态；不把 Composer 的全部 `unavailable` 条件用于恢复忙状态，以免连文本编辑也被禁用。
- 按已确认原型实现前置空行合并、气泡组顶部入口及反馈，不将原型 HTML 导入或移植为产品组件。Pi 的反馈明确“取回到输入框不保证取消，主动再次发送会产生新输入”；不增加重发确认框或“待确认”气泡。
- 不将运行时竞态描述为用户操作错误，不用提示代替真实内容、草稿和附件的正确处理。

## 6. 收敛后的最轻充分方案与证据边界

### 对话内容和气泡记账分开处理

本轮不再将“Pi 竞态中的气泡永不提前消失”作为必须内化的保证。仍保留的硬要求是：真实用户事件必须生成正确的对话内容，后续按 entry FIFO 取得持久身份，不拿本地气泡正文/图片替代。

```text
普通取回
  检查可用性 → 等入队确认 → 固定候选 → 调后端 → 提交本地变化 → 合并最新草稿

恢复后的用户事件
  本地队列：沿用既有 FIFO 记账，不推断这是哪次提交
  实际对话：使用本次真实用户事件的文字/图片，再与持久 entry 对齐

结束边界
  既有 agent_settled / 进程终止 → 结束本轮恢复投影模式
```

Projection 的恢复模式只改变这段运行中的内容来源，不添加逐条身份、不缓存第二份远端队列、不按 `queue_update/get_state` 数量纠正本地列表。保留首次用户事件确认乐观初始回合的结构规则，避免重复建初始回合；恢复模式下也不能靠 `agent_start` 提前把排队气泡虚构成已投递用户回合。普通后续运行回到原有路径。

### 已有证据与不再追求的保证

- 现有生产规则在迟到旧事件中取新队首正文，已经复现内容/图片错配；没有新队首时还可能漏掉旧用户回合。
- 只按真实事件渲染、完全不维护本地队列，会留下已投递气泡；不采用。
- 按真实事件渲染并盲信 Pi 队列数量，仍会被上游同文影子记录错误误导；不采用为精确修正方案。
- 新的最小候选“真实事件内容 + 既有本地 FIFO 记账”已回放四组真实 Pi 时序：所有检查点的文字/图片正确；普通清除后重发路径正确；被刻意放大的迟到场景仍会提前清掉新气泡。这一偏差是本轮明确保留的残余风险，不伪装成测试通过的精确同步。
- 这些只是离线候选对真实时序的回放，未验证生产接入、OMP、重试/下一轮模式清理或 Host 草稿交接；它们进入第 7、8 节的实现验证，不再要求用户判断其私有机制。

### 用 guard 规避，不新增补偿机制

压缩期间前后端一致禁用取回，避开已知较长窗口。长异步扩展仍可能在压缩结束后挂起投递，实验已覆盖这一事实；没有日常发生率数据，不能以“很罕见”作为证据。取回反馈要说明原输入仍可能执行、再次发送是新提交，列表为空不证明取消成功。

不增加“待确认”气泡、同步管理器、定时安全延迟或直到整轮结束的发送锁。若正常操作也持续偏离，或实现无法维持真实对话、草稿/附件的硬要求，暂停并说明影响；不能静默补建框架或继续放宽目标。

## 7. 先确认语义，再选择最少的测试

不按新增函数或生产文件数量配置测试，不追求覆盖率/行数目标。每个用例应能说明它会抓住哪一种实际回归；同一规则不在多个层重复证明。

| 语义场景 | 需要观察的结果 / 能抓住的错误 |
| --- | --- |
| Steer、Queue 同时有内容 | 返回应恢复的内容、保留已有草稿、不自动发送，且当前运行继续；抓“只处理一个队列”或误调用 abort |
| 提交确认与重复点击交错 | 已登记、尚未确认入队的提交不能被一次过早清空漏掉；重复点击不会执行第二次破坏性操作；其他 Session 不被一起阻塞 |
| Pi 旧消息迟到，同时有新提示词排队 | 旧事件的文字/图片及持久身份必须正确；普通气泡流程仍正确，刻意竞态中的提前消失单列为残余偏差，不再要求精确同步 |
| OMP 部分成功、同文输入与后续失败 | 只交付确认取回的部分，失败不丢此前成果；不因自动重试误删另一条同文消息；removed:false 不被冒充“已撤回” |
| 草稿与 presentation 归属 | 合并处理中继续输入的最新内容；tab 关闭交接后仍正确回填一次；切换 Session 不写错草稿或抢无关焦点 |
| 附件与传输限制 | Pi 待处理内容含图时不执行；OMP 正常恢复返回图片；图片缺失/超限有明确关联反馈，不静默丢图或永久转圈 |
| 请求越权 | 一个 tab 请求操作另一个 Session 时，不能触发队列修改；普通合法请求不会被误拒绝 |
| 压缩与反馈 | 压缩中不能执行取回；Pi 的反馈说明残余投递与重发语义，不自动发送，不引入新状态机 |

测试边界：

- 核心事务测试使用真实的恢复 class 和 Projection，只替换 RPC 等外部边界。忙状态和 disposed 不另测 getter：通过重复操作、进程替换后的结果等可观察行为验证。
- Host 测试只补授权、草稿归属和生命周期这些独有分支，不重复测试后端移除算法。
- DOM 测试实际点击 `ClientApp`/`SessionInteraction` 中的入口，观察草稿、焦点、忙状态和反馈，不 mock 掉内部组件。共享行为不为 sidebar/tab 各复制一整套，只补各自的归属差异。
- 已安装 Pi/OMP 的隔离合成流实验用于确认真实后端语义，不替代产品接入测试；Runtime 接线回归与这些证据一起检查，不能拿“按钮测过 + 独立 RPC 脚本测过”声称完整路径已完成。
- 不单独测试薄 API 转发、getter/setter、纯字段复制或内部调用次数；不维护无关的大段 DOM 快照，也不复制实现算法计算 expected。重复取回通过“未二次移除内容、未重复插入草稿”验证，而非只断言某个 mock 被调用一次。

关键反例先证明能让错误实现失败，再验证修复；尤其是迟到消息错配内容、重复取回、部分成功被后续错误抹掉。实现后跑聚焦测试、共享边界检查与两端 JS build；GUI 未验证的维度单独列出，不用构建成功代替。

## 8. 实施顺序与停止条件

同一任务继续留在 `feat/pending-message-recovery`，用 commit 记录进展，不按阶段新建分支。

1. **RPC 与恢复协调：** 接入两个原始操作、专用 class、入队确认与生命周期；验证普通批量操作、重复点击、OMP 部分成功，不做前端假成功。
2. **Projection 的局部内容修正：** 移植已验证的最小方向，补首次用户事件、重试、持久刷新、下一轮和进程终止回归。保留原有队列算法，不扩展为精确队列同步。
3. **Host 与草稿：** 接通有授权的关联请求，按 Host/Webview 归属合并最新草稿；验证切换/关闭 tab、过期结果和附件。Desktop 只做已有有限发布边界的必要适配。
4. **共享 UI：** 接入已确认入口与反馈，压缩禁用，禁止重复取回；两种 presentation 复用同一实现。不新增未确认状态，不自动重发。
5. **验收完整路径：** 实际点击→后端取回→投影→草稿回填，真实 Pi/OMP 隔离验证及聚焦回归、两端 JS build、diff 漂移检查。区分实测、模拟和未验证项。

有界技术细节由 Agent 在这些步骤中处理，不再将队列内部时序交给用户作选择。只有发现会改变产品目标、数据安全、已说明的残余风险或核心架构边界的新事实时才暂停升级。

正常波动：机械类型/fixture 更新或测试文件拆分不必改形状。**需要暂停重审：** 修改 `PiRpcConnection`/dialect 的状态职责、改写持久化、重构整个 Projection、增加通用恢复管理器/持久恢复箱、引入新的 Desktop IPC 分块，或跨出上面列明的核心边界。

用户已批准本轮规范并授权实施，本文为 `locked` 基线。保留原始预测，不在实现中或完成后修改它以追认实际 diff；普通波动与实质漂移记录在 PLAN，实质改变须按重审规则处理。
