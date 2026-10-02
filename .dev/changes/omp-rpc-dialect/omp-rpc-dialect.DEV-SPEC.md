---
title: OMP RPC 方言与运行时兼容分层
description: 把 Oh My Pi 兼容拆成 RPC 方言层(机制 + 同构翻译)与业务兼容层(能力差异),修复大会话 resume,并显式声明本轮不支持的能力。
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-10-02
---

# OMP RPC 方言与运行时兼容分层

配套:`omp-rpc-dialect.SHAPE.md`(结构预测)、`omp-rpc-dialect.LEGACY-COMPAT.md`(迁移基线,记录当前散落的兼容实现与实测事实)。

## Problem Statement

用户视角的两个症状:

1. 在 `oh-my-pi` profile 下 resume 一个大会话(约 2 MB / 745 条目)直接失败,面板显示 `Unable to load conversation history: RPC response exceeded the transport limit`;同一个会话的进程本身是活的(实时回复正常)。
2. `/` 仅剩 3 个 FrostPi 本地命令,运行时命令列表始终为空。

两者同源,但更关键的是**结构问题**:OMP 兼容目前没有"兼容的样子"。它一部分是配置数据(可执行名、默认 session root、是否读 Pi settings),另一部分则是**直接长在 Pi 会话层里的分支**(按兼容值分支的 settings/cache-miss 逻辑、以 adapter 形式写在会话运行时的 OMP 事件名映射、以及即将出现的协议版本判断)。结果是:每修一处 OMP 差异,都要往 Pi 路径里再加一个运行时专用分支。

用户对成功的定义:

- OMP 兼容必须分层且显式:**RPC 层**解决消息/帧层面的差异(同构则忠实翻译),**能力层面**的差异打标记、由业务层再兼容;
- Pi 运行路径保持纯 Pi,不再出现 OMP 字面量;
- 已坏能力(resume)必须修复;
- 本轮**只支持最基本的能力**:普通对话与 resume;**tree、fork、slash 命令暂不支持**,在代码中显式标记为不支持;
- 不引入中立词表、插件系统或通用第三方运行时机制。

## Approach

**Pi 为主,不是并列。** 合同语言(接口与词汇)取 Pi 的;OMP 是这份合同的翻译实现。理由:文档已把产品定位为"over Pi's native RPC surface 的适配器",non-goals 明确排除通用运行时与协议转换;并列需要发明中立词表并重写全部消费者,收益为零。

沿用**同构判定四条件**,作为"翻译 / 标记"的唯一判据:

> 差异算同构(→ RPC 层直接翻译)当且仅当:
> ① Pi 侧的名字与形状能仅由该帧本身算出,不需要额外状态;
> ② 载荷 1:1 映射且无信息丢失;
> ③ 不引入新的时序/顺序保证;
> ④ 失败语义相同。
> 四条全满足 → RPC 层翻译;否则 → 打标记 + 业务层兼容。

依赖方向:RPC 层 = 无方言的传输机制 + 每运行时方言(只做同构翻译与标记注入,不含业务判断);业务层 = 运行时契约(进程/目录/设置归属/启动模式/能力声明)+ 单一 OMP 业务兼容模块(消费标记)。每个差异只有一处归属,两层不得各翻译一次。

被拒绝的替代:中立词表/双向等价(重写全部 Pi 词汇与消费者,收益为零);现在就拆出独立 OMP 包(只有一个额外方言,目录边界足够)。

## Behavior Contract

### 帧与上限

- Pi:一行一条消息,无上限声明、无分片概念;行为不变。
- OMP:单行上限 1 MiB,并在启动 `ready` 帧宣告协议版本与帧上限。
- 当 profile 为 `oh-my-pi` 且运行时宣告支持协议 v2 时,FrostPi 协商 v2;协商成功后,超出单行上限的逻辑帧以分片帧送达并由 FrostPi 重组。
- 未宣告 v2 或协商未启用时保持 v1 语义:超限**响应**被替换为错误(现状),超限**事件**被运行时裁剪(归一化后以标记呈现)。
- 可观察结果:`oh-my-pi` 下 resume 该大会话成功,条目数与运行时报告一致;v1 对照仍报同一错误。

### 事件归一化

- OMP 的会话结束事件在 RPC 边界被翻译为 Pi 的 `agent_settled`;OMP 的 `agent_end` 保持原名。app 侧观察到的序列与 Pi 一致,会话回到 `ready` 的时机与 Pi 相同。
- OMP `agent_end` 是否携带等价于 Pi `willRetry` 的重试信息**未确认**,见"未决"。

### OMP 支持面(本轮显式声明)

支持:

- 启动与进程生命周期;普通对话(`prompt`,含流式过程中的 steer / follow-up 与中止);
- 历史加载与 resume(会话发现、恢复);
- 模型与思考级别切换;
- 扩展 UI 对话框(含 FrostPi 注入的 question 工具)。

**不支持,并必须在代码中显式标记为不支持**(不得静默、不得露出入口后才报运行时错误):

- session-tree 与 fork(分支切换);
- slash 命令发现与 `/` 补全(含 skill 命令列表)——许多 slash 命令依赖 TUI,当前无法逐一分辨,因此整类不支持;
- 运行时 tool UI(`--mode rpc-ui` 的 `ask` 对话框)。

说明:skill 的**内容**仍可经普通 prompt 正常使用;被拒绝的只是"命令列表/补全"这一层。

### 截断标记

- 当运行时明确表示数据被截断时,归一化输出携带一个可选的兼容注记(字段名未定),**仅用于诊断/提示,不驱动任何状态机**。

### Pi 路径

- 默认 profile 下行为逐条不变,现有契约与测试不受影响。

## Implementation Decisions

- RPC 包内分层:传输机制(分帧、分片重组、请求关联、超时、子进程)与运行时方言分离;传输层不得出现任何运行时名。分片重组是机制,无条件可用;协议协商是能力,由方言声明。
- 归一化契约沿用 Pi 词汇(即当前 API 形状),app 消费者继续只依赖该契约 → 会话、投影、模型等 Pi 路径不再出现 OMP 字面量。
- 同构差异表:`session_settled → agent_settled`(同构);协议 v2 + 分片重组(机制)。
- 已提交在会话层的 OMP 事件投影回滚,迁入方言。
- 不支持面由运行时契约显式声明(能力为 false),调用点据此给出可见结果;不使用"静默回退"或"事后 Unknown command"。
- 标记机制只有一个,且"只携带诊断、不驱动逻辑";需要驱动逻辑的差异必须在业务层显式实现,且只在这一个模块里。
- 业务层 OMP 兼容只有一处装配点,由 profile 选择。
- 文档同批更新:`packages/pi-rpc/SPEC.md` 的 Boundary(现自称 "subprocess and JSONL transport only")改为"传输 + 每运行时方言";`session-lifecycle.SPEC.md` 与 `conversation-projection.SPEC.md` 中 `agent_settled` 的措辞说明该边界由 RPC 层归一化产生;新增迁移基线说明文档。
- 非目标(本轮不做):中立词表、插件系统、能力矩阵、slash 命令发现与 `/` 补全、session-tree/fork、运行时 tool UI(`ask`)、`prompt_result` 消费。

### 未决(不阻塞第一步)

- 命名:归一化契约名、方言目录名、标记字段名(提案 `runtimeCompat` 待定)、业务层源码目录名。
- OMP `agent_end` 的重试语义是否与 Pi 的 `willRetry` 同构。
- 截断标记的落地范围:先只做"事件被裁剪"一种。

## Acceptance Criteria

### Agent Check

- `packages/pi-rpc` 单测:
  - 分片重组:非分片直通;多片按序重组;分片跨 stdout 写入边界;元数据/长度/序列不合法判为协议错误。
  - 协议协商:运行时宣告 v2 且 profile 允许 → 发出协商请求并成功后启用 v2;未宣告 v2 或 profile 不允许 → 不发出协商请求且保持 v1;协商失败 → 显式失败,不得退化成"后来才出现的错误"。
  - 方言归一化:`oh-my-pi` 方言把会话结束事件归一化为 `agent_settled`;`pi` 方言行为不变。
- `apps/vscode` 单测:`oh-my-pi` profile 下,归一化后的 settle 到达时会话状态为 `ready`、回合 completed、settle 后的刷新路径被执行;`pi` profile 逐条不变;运行时契约对不支持项(会话树/分支、命令发现、tool UI)声明为 false 并被断言。
- 真实 OMP 冒烟(会话文件副本,不触碰在线会话):v2 下 `get_entries` 成功且条目数一致;v1 对照报 `RPC response exceeded the transport limit`。
- `pnpm check`(版本检查、lint、typecheck、单测、build、bundle size)通过。

### User Check

1. 安装新 VSIX 后打开 `check-omp setting` 会话:历史正常加载,不再出现 "Unable to load conversation history"。
2. 一个回合结束后右下角停止按钮复位(回归已完成的修复)。
3. `oh-my-pi` 下:普通对话正常;session-tree / fork / `/` 命令列表表现为明确"该运行时不支持"(入口不出现或给出明确提示),不出现点击后才报错的情况。

## Terminology

- **方言(dialect)**:同一项 Pi RPC 能力在某个运行时里的方法名、事件名、载荷形状与帧法的总称。
- **同构翻译(isomorphic translation)**:满足上面四条件的方言差异,可在 RPC 层直接改写而不丢失含义。
- **标记(marker)**:归一化输出上的可选兼容注记,只携带诊断/可选信息,不参与状态判断。
- **传输机制(transport mechanism)**:与运行时无关的分帧、分片重组、请求关联、超时与子进程管理。
- **运行时契约(runtime contract)**:非 RPC 的运行时事实与能力声明——可执行名回退、默认 session root、是否读 Pi settings、启动模式,以及是否支持会话树/分支、命令发现、tool UI。
- **兼容 profile**:设置项 `frostpi.pi.runtimeCompatibility` 的取值,当前为 `pi` 与 `oh-my-pi`。
