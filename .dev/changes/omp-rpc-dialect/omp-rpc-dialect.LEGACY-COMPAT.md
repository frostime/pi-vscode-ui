---
title: 旧版 OMP 兼容现状说明(迁移基线)
description: 记录当前分支上散落的 Oh My Pi 兼容实现、已实测的运行时事实与已知缺口,作为分层重构的迁移基线。
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/**
updated: 2026-10-02
---

# 旧版 OMP 兼容现状说明(迁移基线)

本文件描述**重构之前**的现状:OMP 兼容以"散落的配置数据 + 长在 Pi 路径里的分支"形式存在。它是迁移基线,不是长期契约;重构完成后由 `omp-rpc-dialect.DEV-SPEC.md`、`packages/pi-rpc/SPEC.md` 与各模块 SPEC 取代。证据标注:`[实测]` = 在本机用真实可执行/真实会话验证过;`[源码]` = 由运行时源码确定;`[推断]` = 尚未验证。

路径约定(便于换机器继续):

- 仓库内路径相对工作区根 `d:/Arsenal/PlayCode/pi-vscode-ui`。
- `<OMP_NPM_DIR>` := 全局 node_modules 中 `@oh-my-pi` 作用域目录(本机 `D:/Envs/bun/install/global/node_modules/@oh-my-pi`,基线 `pi-coding-agent@18.4.9`);OMP 源码写成 `<OMP_NPM_DIR>/pi-coding-agent/src/...`。
- `<PI_CLI_DIR>` := 上游 Pi CLI 包(本机 `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent`,基线 `0.99.1`)。

## 1. 当前散落的兼容点(inventory)

| 位置(符号) | 现状形式 | 迁移归属 |
|---|---|---|
| `configuration/runtimeCompatibility.ts` | 纯数据 profile:`id`、可执行名回退、默认 session root、`usesPiSettings` | 收敛为**运行时契约**(补能力声明),目录化 |
| `configuration/configuredPiInvocation.ts` | 经 profile 取可执行名回退 | 改依赖契约 |
| `configuration/readConfiguration.ts` / `configurationTypes.ts` | 取值校验、类型穿透 | 保留(校验不变) |
| `sessions/SessionRuntime.ts`(`PI_OMP_ADAPTER.projectSettleEvent`) | OMP `session_settled` → `agent_settled` 的事件投影**写在会话运行时内** | 迁入 **RPC 方言** |
| `sessions/SessionRuntime.ts`(`usesPiSettings` 分支) | 是否读 Pi settings / cache-miss 通知按兼容值分支 | 迁入**契约**(其余 Pi 逻辑保持) |
| `models/resolvePiModelScope.ts` | `usesPiSettings` 决定是否读 Pi `enabledModels`(Scoped 视图) | 改依赖契约 |
| `sessions/catalog/SessionCatalog.ts` / `SessionCatalogPicker.ts` | 默认 session root 来自 profile | 改依赖契约 |
| `sessions/SessionRegistry.ts` | 装配会话、诊断摘要 | 改依赖契约 + 诊断补"运行时 + 已协商协议" |
| `packages/pi-rpc/src/PiRpcApi.ts` | 方法名固定为 Pi 方言(`get_commands`、`fork(entryId)`、`compact` …) | 引入**方言维度**;Pi 方言为默认实现 |
| `packages/pi-rpc/src/PiRpcConnection.ts` | 启动只做 `get_state`;`--mode rpc` 固定;对帧上限/分片无感知 | 补**机制**(分片重组)+ 由方言声明的**协商** |
| `packages/pi-rpc/src/process/resolvePiExecutable.ts` | 内含 Pi 名与 Pi CLI 探测(`pi`、`pi-coding-agent`) | 保留为家族默认;契约负责传可执行名 |

## 2. 已实测/源码确认的运行时事实

| 事实 | 证据 |
|---|---|
| OMP 启动即推 `ready`:`protocolVersion 1`、`supportedProtocolVersions [1,2]`、`maxFrameBytes 1048576`、`maxReassembledFrameBytes 67108864` | `[实测]` |
| OMP 单行上限 1 MiB;**协议 v1 下超限响应**被替换为 `{success:false, error:"RPC response exceeded the transport limit"}` | `[源码]` `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-frame.ts` + `[实测]` 2,108,760 B 会话的 `get_entries` 复现 |
| 协商 `negotiate_protocol {protocolVersion:2}` 成功后,超限逻辑帧以 `rpc_chunk` 分片(256 KiB/片,base64)送达,重组上限 64 MiB | `[源码]` + `[实测]` 同一会话 745 条目 / 2.5 MB 成功 |
| v1 下超限**事件**不是报错而是被逐级裁剪(如 `agent_end` 丢 `messages` 只留 `messageCount`) | `[源码]` `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-frame.ts` 的 `SHRINK_PASSES` / `compactTerminalFrame` |
| OMP 回合结束序列:`agent_end` → `prompt_result` → `session_settled`;**全仓不存在 `agent_settled`** | `[源码]` + `[实测]` 两次抓流 |
| OMP 无 `fork`;同名语义在 `branch`(`session.branch(entryId)` → `{text, cancelled}`),且 `branch` 会 abort 未决 prompt(detached run 不发终帧) | `[源码]` `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-mode.ts` |
| OMP 命令发现是 `get_available_commands`,并主动推 `available_commands_update`;`get_commands` 返回 `Unknown command` | `[源码]` + `[实测]` |
| OMP 支持扩展命令(`prompt "/name …"`)与扩展 UI;FrostPi 注入的 question 工具可正常工作 | `[实测]` |
| OMP 的运行时 tool UI(`ask`)需要 `--mode rpc-ui`;富对话框还需宿主 `set_ask_dialog`;FrostPi 均未实现 | `[源码]` |
| Pi(原版)`dist` 无 `rpc_chunk` / `maxFrameBytes` / `negotiate_protocol` → Pi 一行一消息、无上限声明 | `[实测]` 已安装的 `<PI_CLI_DIR>` |

## 3. 已知缺口(用户可见)

| 缺口 | 现状 | 本轮处置 |
|---|---|---|
| resume 大会话失败 | `get_entries` 响应超限 → 报 `RPC response exceeded the transport limit` | **修复**(协商 v2 + 分片重组) |
| `/` 列表为空 | 命令发现方法名不匹配 → 只剩 3 个 FrostPi 本地命令 | **不做**,显式标记不支持(整类 slash 命令不支持) |
| session-tree / fork 不可用 | 其可用性由命令发现决定,今天"侥幸"隐藏 | **不做**,契约显式声明不支持,保证可见 |
| `prompt_result` 未消费 | 扩展命令完成判定仍靠 `get_state` 轮询 + 多重延迟试探 | 后续单独立项 |
| v1 帧裁剪静默 | 未协商时事件可能被裁剪 | 归一化后以兼容标记呈现 |
| tool UI / `ask` 不可用 | 需要 `--mode rpc-ui` + `set_ask_dialog` + 宿主处理 `ask` 帧 | 后续单独立项 |

## 4. 迁移映射(现状 → 目标)

- 会话层 OMP 事件投影 → RPC **方言**(`session_settled` → `agent_settled`)。
- 散落的配置数据 + `usesPiSettings` 分支 → **运行时契约**(数据 + 能力声明)。
- 帧上限感知 + 分片重组 → **传输机制**(无条件可用);协商 → **方言声明**。
- 方法名差异(`get_commands` 等)→ 方言预留,本轮不启用。
- 迁移后 Pi 路径(SessionRuntime / ConversationProjection / SessionViewState / 模型 / 目录)不含任何 OMP 字面量。

## 5. 不在本说明范围

- OMP 的 extras(subagents、host tools、`get_tree`、`predict_word`、`login`、`set_todos`、`export_html`、fast mode 等);
- OMP 设置模型(`config.yml` / profiles)的读取或映射;
- 混合 Pi/OMP 会话列表或按会话识别运行时;
- 通用第三方运行时插件机制与 ACP。
