---
status: accepted
---

# SHAPE: OMP RPC 方言与运行时兼容分层

配套 SPEC:`omp-rpc-dialect.DEV-SPEC.md`、迁移基线:`omp-rpc-dialect.LEGACY-COMPAT.md`(同目录)。本文件只预测**结构与归属**,不写声明与局部逻辑。

> 修订(2026-10-02,spec 细化后):本轮 OMP 支持面收敛为"普通对话 + resume + 模型/思考级别 + 扩展 UI 对话框";session-tree / fork / slash 命令发现 / 运行时 tool UI 四类**显式声明为不支持**,并由运行时契约断言。新增迁移基线文档。方向未变,状态保持 accepted。

> 用户后续确认:同时支持 RPC v1/v2,支持 v2 时协商,否则保持 v1。移除 `runtimeToolUi` 能力字段;普通 `--mode rpc` 不注册 OMP 内置 `ask`,不另做能力门控。FrostPi Question tool 保持启用。下列历史预测中的 tool UI 能力声明由本条修订取代。

## 叙述

变更把一个"每修一处 OMP 差异就往 Pi 路径里加分支"的现状,改成两层显式归属:RPC 包内新增**传输机制 / 运行时方言**的分界,并让协议协商与分片重组成为机制能力;app 侧把现有的运行时配置数据收敛成**运行时契约**,业务层只留一个 OMP 兼容模块。结果是 Pi 路径(SessionRuntime / ConversationProjection / SessionViewState / 模型与目录)"看不到" OMP,而 OMP 的全部怪癖集中在方言与业务兼容两个文件/目录里。

结构上最关键的三个决定:归一化契约仍是 Pi 词汇(app 消费者不改依赖);分片重组无条件可用、协议协商由方言声明;每个差异只有一个归属(两层不得各翻译一次)。

## 预测 diff

```text
packages/pi-rpc/
├── SPEC.md                     modify  +25–45/-10–20    Boundary 从 "transport only" 改为"传输 + 每运行时方言";补分片/协商契约
├── src/
│   ├── transport/
│   │   ├── JsonlDecoder.ts     move    ~0                分帧语义不变,仅位置
│   │   ├── protocolErrors.ts   move    ~0                错误分类不变
│   │   ├── RpcChunkAssembler.ts create +110–150          rpc_chunk 重组(现草稿移入并接线)
│   │   └── (process/*)         move    ~0                可执行解析、stderr 缓冲
│   ├── dialects/
│   │   ├── pi/                 move    ~0                现 PiRpcApi + rpcTypes 原样成为默认方言
│   │   └── ohMyPi/             create  +120–200          OMP 方言:ready 解析、协商声明、
│   │                                                      session_settled→agent_settled、
│   │                                                      截断标记注入;不含业务判断
│   ├── PiCompatibleRpcApi.ts   create  +40–70             归一化契约(接口与类型面,名字待定)
│   ├── createRpcClient.ts      create  +30–60             工厂:按运行时装配方言 + 机制
│   ├── PiRpcConnection.ts      modify  +50–80/-15–25      接入 assembler、ready 捕获、协商选项
│   └── index.ts                modify  +5–15/-5–15        导出面保持向后兼容
└── test/
    ├── RpcChunkAssembler.test.ts  create +90–140          分片:直通/多片/跨写边界/非法序列
    ├── ProtocolNegotiation.test.ts create +70–110         协商:宣告、未宣告、失败
    └── PiRpcConnection.test.ts     modify +30–50/-5–10    接线回归

apps/vscode/src/extension/
├── runtime-compatibility/        create dir (业务层入口)
│   ├── runtimeContract.ts        create +50–80            运行时契约:进程/目录/设置归属/启动模式/能力
│   ├── piRuntime.ts              create +15–30            Pi 事实(纯)
│   ├── ohMyPiRuntime.ts          create +45–90            OMP 事实 + **能力声明**(会话树/分支、
│   │                                                      命令发现、tool UI = false),不支持项的唯一来源
│   ├── ohMyPiSessionCompat.ts    create +30–70            OMP 业务兼容(本轮近乎空:仅标记消费占位)
│   └── runtimeCompatibility.ts   move   ~0(+10–20)        现配置模块并入该目录,成为契约入口
├── configuration/
│   ├── configuredPiInvocation.ts modify ~small            改依赖契约而非 profile 函数
│   └── readConfiguration.ts      modify ~small            取值校验不变
├── models/resolvePiModelScope.ts modify ~small            改依赖契约
├── sessions/
│   ├── catalog/SessionCatalog.ts        modify ~small      默认根来自契约
│   ├── catalog/SessionCatalogPicker.ts  modify ~small      同上
│   ├── SessionRuntime.ts         modify +45–70/-35–55     删除 PI_OMP_ADAPTER;改用契约+工厂;
│   │                                                      连接选项带入协商能力
│   └── SessionRegistry.ts        modify +10–25/-5–10      装配契约与业务兼容模块;诊断补运行时/协议
└── 测试
    ├── test/unit/SessionRuntime.test.ts           modify +20–40/-20–40  删 OMP 投影断言,改断契约装配
    ├── test/unit/runtimeCompatibility.test.ts     modify +20–40           契约数据与能力声明
    └── test/unit/ohMyPiSessionCompat.test.ts      create +40–70           业务层兼容(标记消费/能力不可用)

文档(必须与实现同批)
├── .dev/docs/protocol/pi-rpc-compatibility.md   modify +20–40/-5–15  补"方言层 + 分片/协商"条款
├── apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md        modify 说明 settle 边界由 RPC 层归一化
├── apps/vscode/src/extension/conversation/conversation-projection.SPEC.md modify 同上
└── CHANGELOG.md                                  modify +2–4           修 resume + 结构说明

本次 change 文档(不随实现提交)
└── .dev/changes/omp-rpc-dialect/
    ├── omp-rpc-dialect.DEV-SPEC.md       create  契约与验收
    ├── omp-rpc-dialect.SHAPE.md          create  结构预测(本文件)
    └── omp-rpc-dialect.LEGACY-COMPAT.md  create  迁移基线:散落兼容点 + 实测事实 + 缺口

废弃
└── .dev/changes/runtime-compatibility/  按用户决定:本轮不动、不归档
```

## 跨模块归属 / 依赖变化

- **事件词汇归一化**:`SessionRuntime` 内的 OMP 分支 → `packages/pi-rpc` 的 OMP 方言。会话层恢复为纯 Pi。
- **传输上限/分片**:此前无归属(FrostPi 完全不感知) → 传输机制负责重组,方言负责是否协商。任何 Pi 路径不再假设"一行一消息无上限"成立与否。
- **进程与启动事实**:分散在配置模块与各消费者 → 单一运行时契约;消费者只读契约。
- **命令发现**:方法名此前固定在 typed API 里 → 由方言决定(本轮不启用,仅预留位置,不在实现 diff 内)。
- **依赖方向**:app → Pi 词汇归一化契约(定义在 RPC 包)← 方言实现;传输层不含任何运行时名;业务层 OMP 模块只被 `oh-my-pi` 契约装配。

## 备选与取舍

- 独立 OMP 包(`packages/omp-rpc`):依赖隔离最彻底,但当前只有 1 个额外方言,目录边界已足够;若出现第三个方言再抽取,避免现在承担跨包接口与构建成本。
- 中立词表/并列:需要重写全部 Pi 词汇与消费者,收益为零,已排除。

## 待确认(不阻塞第一步)

- 命名:归一化契约名、方言目录名、标记字段名、业务层源码目录名(暂沿用 `runtime-compatibility/`;它与旧 change 目录同名但位于源码树)。
- OMP `agent_end` 重试语义是否与 Pi `willRetry` 同构(决定业务层是否需要这条差异)。
- 已定(不再待定):session-tree/fork、slash 命令发现、运行时 tool UI 三类由运行时契约显式声明为不支持;旧 `.dev/changes/runtime-compatibility/` 本轮不动。

以上未决项不影响第 1 步(零行为重构:目录化 + 工厂 + 契约装配)。
