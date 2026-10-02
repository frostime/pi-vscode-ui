---
title: OMP Compatibility Architecture
description: OMP 兼容的两层职责、差异归属判据、新能力推进方式与归档要求。
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-10-03
---

# OMP 兼容维护

修改 Oh My Pi (OMP) 兼容时先读本文,再读 [RPC 合同](../../../packages/pi-rpc/SPEC.md)、[跨模块协议策略](../protocol/pi-rpc-compatibility.md) 和受影响模块的相邻 SPEC。本文保存长期设计与维护规则,不依赖任何 change、handover 或会话上下文;临时计划和验证记录可以归档。

## 兼容理念

FrostPi 以 Pi RPC 的 API 和事件词汇为合同,OMP 是这份合同的兼容实现。保留 Pi 主路径行为,不创建中立词表、通用运行时插件系统或第二套产品状态机。

目标是完成用户需要的功能。协议翻译、能力声明和消息标记是实现手段,不能成为额外阻止合法功能的理由。一个差异只有一个处理归属;不得在 RPC 方言层和会话层重复翻译。

暂未支持不等于永久排除。slash commands、session tree 和 fork 有后续兼容方向,但必须先证明其语义能够满足产品合同,再开放入口。

## 两层职责

```text
OMP 子进程
    |
    v
packages/pi-rpc
  传输机制:进程、JSONL、分片重组、请求关联、失败清理
  OMP 方言:启动协商、无损消息转换、必要的差异信息
    |
    v
VS Code Extension Host
  运行时契约:启动事实、目录、设置归属、能力声明
  OMP 业务兼容:有状态或非同构功能的具体实现
    |
    v
会话生命周期 / 会话投影 / 归一化 Webview 合同
```

### RPC 方言层

[RpcDialect](../../../packages/pi-rpc/src/dialects/RpcDialect.ts) 和 [OMP 方言](../../../packages/pi-rpc/src/dialects/ohMyPi/ohMyPiRpcDialect.ts) 拥有运行时消息差异。[PiRpcConnection](../../../packages/pi-rpc/src/PiRpcConnection.ts) 与 [RpcChunkAssembler](../../../packages/pi-rpc/src/protocol/RpcChunkAssembler.ts) 执行传输机制,不按 OMP 名称分支,不依赖 VS Code。

当前方言接口处理启动协商和事件归一化;[PiRpcApi](../../../packages/pi-rpc/src/PiRpcApi.ts) 仍是 Pi 命令面。将来需要命令或响应翻译时,在 RPC 包内扩展实际需要的方言边界,不要把 OMP 动词判断塞进会话业务。

RPC 层不决定重试、会话身份替换、用户 turn 完成、UI 展示或能力是否开放。流式内容拼装仍由会话投影负责。

### 业务兼容层

[runtimeCompatibility.ts](../../../apps/vscode/src/extension/configuration/runtimeCompatibility.ts) 当前集中声明可执行回退、默认 session root、Pi 设置归属及能力。[SessionRuntime](../../../apps/vscode/src/extension/sessions/SessionRuntime.ts) 按已启动进程的 profile 装配方言、扩展及能力门控。

当前上层主要是契约与门控,没有独立 OMP 业务兼容模块。首次出现真实的非同构行为时,建立具名的 OMP 兼容模块,在运行时装配点选择它;Pi 会话和投影代码消费明确的结果,不散落 `if (isOmp)`。不要预先创建空模块或框架。

每个 SessionRuntime 仍只拥有一个进程。子进程是会话文件、模型状态和扩展生命周期的权威;不得为兼容静默新建空会话、代写会话文件或增加全局执行锁。

## 翻译还是上层兼容

仅当以下四项全部成立,才按同构差异直接翻译:

1. Pi 名字与形状可由该消息本身计算,无需额外业务状态。
2. 载荷能完整映射,不丢信息或伪造字段。
3. 不新增时序、顺序或完成保证。
4. 失败与取消语义保持一致。

任一项不成立,就保留必要的差异信息,由上层具名兼容模块处理。不能仅凭方法名相近或返回值相似认定等价。

| 差异 | 处理方向 |
|---|---|
| `session_settled` 名称不同 | 当前在 RPC 边界归一化为 `agent_settled`;不把较早的 `agent_end` 当作替代完成事件 |
| `get_available_commands` 与 `get_commands` | 核对描述字段、命令来源和失败语义后,判断能否在 RPC 层转换;可执行性由业务层决定 |
| OMP `branch` 与 Pi `fork` | 先核对提交边界、会话身份、abort 和历史重载;不能直接重命名调用 |
| 重试、后台任务、`prompt_result` | 核对跨消息状态与完成边界,不得凭单帧猜测 Pi `willRetry` |

当前没有通用 marker 字段。需要标记时先定义具体含义、类型和唯一消费者,保留原始信息。诊断注记只用于提示或诊断,不得隐式驱动状态机;功能差异若需要参与控制,必须有显式的类型和上层兼容合同。运行时能力声明负责产品入口,不是从某个事件 marker 临时推断出来的开关。

## 已有协议与支持边界

- RPC v1/v2 是传输协议版本,不是 OMP 软件发行版本。根据 `ready` 的能力声明选择,不要按 package version 猜测。
- 声明支持 v2 就发起协商,不要求字节上限等于基线。协商失败明确失败,不静默退回 v1;未声明 v2 则继续 v1。
- 对端声明的物理和逻辑上限配置当前连接的重组器。缺失声明使用基线默认值,非法声明明确失败。不能把 OMP 当前的 256 KiB 单片、256 片或 64 MiB 参数升级为未经论证的固定 FrostPi 功能预算。
- v1 大 response 仍可能返回 transport-limit 错误,超大事件可能被 OMP 裁剪。v1 截断诊断尚未实现,不能声称所有历史尺寸均可恢复。
- 基础对话、历史/resume、模型/thinking level 和扩展 UI 是当前兼容范围。tree、fork、运行时 slash 发现和执行当前未开放;普通 prompt 使用 skill 内容不等于支持 slash skill 命令。
- FrostPi Question tool 通过注入扩展的 `ctx.ui.input()` 和 `extension_ui_request` 工作,仍受用户启用设置控制。OMP 内置 `ask` 在普通 `--mode rpc` 下不注册;其 `rpc-ui` / `set_ask_dialog` 是另一条路径,不得与 Question 混为一谈,也不设 `runtimeToolUi` 字段。
- FrostPi 宿主本地命令与运行时 slash 是不同路径,前者不能作为 OMP 运行时命令已支持的证据。

## 新能力怎么推进

1. 明确用户要完成的操作和验收结果,先读对应产品 SPEC。Pi 的 fork/tree 身份与提交合同、turn 完成边界不能被方法名翻译替代。
2. 核查实际 OMP 安装版本的源码或文档,记录证据版本。优先定位 `src/modes/rpc/{rpc-mode,rpc-types,rpc-frame,rpc-client,rpc-session-settle}.ts`,按需追踪具体 command/tool 实现;不要依赖上一位 Agent 的转述或永久写死机器路径。
3. 按四条件划分 RPC 翻译与业务兼容。拿不准且会影响方案时,做最小技术验证;区分源码事实、实测结果与待确认产品选择。Agent 写的 SPEC 不自动构成用户批准。
4. 按可独立验收的结果拆分变更。协议与运行时契约可分工,公共接口先对齐;跨层整合和生命周期验收由主 Agent 负责。功能闭环验证前保持能力关闭,不得露出入口后才返回 `Unknown command`。
5. 添加行为测试:Pi 回归、OMP 成功/取消/失败、协议异常及跨消息时序。命令发现不证明命令能安全执行;tree 操作必须验证身份、提交和恢复行为。新支持范围或资源限制需要明确依据,不能以防御性门槛替代可用功能。
6. 做真实运行时验证。历史/resume 使用 JSONL 及其同名目录的副本,不重启或修改在线会话。先跑局部测试,再按 [测试规范](../testing.md) 和 [发布流程](../release.md) 运行全量检查、打包验证及 VSIX 用户验收。协议冒烟不能替代最终 UI 工作流测试。
7. 用小 checkpoint 保存独立结果。外部 review 是待核查的证据,不是修改授权;主 Agent 必须核对重要发现。同步受影响的代码注释、SPEC 和本文,不把实际未实现的预测结构写成现状。

## 收尾与归档

change、handover、任务编排和临时 SOP 是开发记录,不作为永久维护入口。任务结束时先完成以下事项,再按仓库约定归档:

- 将稳定的跨模块理念和推进规则迁入本文,模块行为迁入相邻 SPEC,验证/发布操作迁入对应长期指南。
- 将仍未完成的能力和问题保留在 backlog,不要随已完成 change 一起掩盖。
- 保留结果、验证范围和未决项的历史记录;归档不等于验证通过,也不抹去实际仍有的缺口。
- 更新文档索引,检查长期文档和入口代码注释不依赖已归档的 change 路径。后续 Agent 应能仅从 `.dev/docs/index.md`、本文和当前 SPEC 开始工作。

本文更新触发条件:兼容理念、层间归属、支持边界、协议选择或新能力推进规则发生实质变化。局部算法细节留在代码和测试中,不在本文维护逐文件变更清单。
