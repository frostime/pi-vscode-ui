---
title: omp-rpc-dialect Context Map
created: 2026-10-02T12:37:31+08:00
updated: 2026-10-02T12:37:31+08:00
---

# omp-rpc-dialect Context Map

任务范围:把 OMP 兼容拆成「RPC 方言层(机制 + 同构翻译)」与「业务兼容层(能力声明 + 标记)」,修复大会话 resume。

路径约定:

- 仓库内路径相对工作区根:`d:/Arsenal/PlayCode/pi-vscode-ui`。
- `<OMP_NPM_DIR>` := 全局 node_modules 中 `@oh-my-pi` 作用域目录(本机 `D:/Envs/bun/install/global/node_modules/@oh-my-pi`,基线版本 `pi-coding-agent@18.4.9`)。
- `<PI_CLI_DIR>` := 全局 node_modules 中的上游 Pi CLI 包(本机 `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent`,基线 `0.99.1`)。

## Core Files — 本任务产物

- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.DEV-SPEC.md` — 需求与行为契约(含本轮支持面)
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.SHAPE.md` — 结构预测,`status: accepted`
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.LEGACY-COMPAT.md` — 迁移基线:散落兼容点、实测事实表、已知缺口
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.handover.md` — 本次交接文档
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.MAP.md` — 本文件

## Core Files — 仓库内待改

- `packages/pi-rpc/SPEC.md` — 模块契约;Boundary 现自称 "subprocess and JSONL transport only",需扩为「传输 + 每运行时方言」
- `packages/pi-rpc/src/PiRpcConnection.ts` — 子进程 + JSONL 关联 + 启动握手;需接分片重组与协商选项
- `packages/pi-rpc/src/PiRpcApi.ts` — Pi 动词面(`get_commands`、`fork(entryId)`、`compact` …);方言维度的落点
- `packages/pi-rpc/src/protocol/rpcTypes.ts` — Pi 载荷/事件 schema 与类型守卫
- `packages/pi-rpc/src/protocol/JsonlDecoder.ts` — 分帧语义(禁换 readline)
- `packages/pi-rpc/src/protocol/RpcChunkAssembler.ts` — 分片重组草稿(**未接线**,已在索引中)
- `packages/pi-rpc/src/process/resolvePiExecutable.ts` — Pi 家族可执行解析(`pi`、`pi-coding-agent` 探测)
- `apps/vscode/src/extension/configuration/runtimeCompatibility.ts` — 现兼容 profile(纯数据),将收敛为运行时契约
- `apps/vscode/src/extension/sessions/SessionRuntime.ts` — 模块级 `PI_OMP_ADAPTER`(OMP 事件投影,待迁入方言)与 `usesPiSettings` 分支
- `apps/vscode/src/extension/sessions/SessionRegistry.ts` — 会话装配与诊断摘要
- `apps/vscode/src/extension/models/resolvePiModelScope.ts` — `usesPiSettings` 影响 Scoped 视图
- `apps/vscode/src/extension/sessions/catalog/SessionCatalog.ts` / `SessionCatalogPicker.ts` — 默认 session root 来源
- `apps/vscode/src/extension/configuration/configuredPiInvocation.ts` — 可执行名回退
- `.dev/docs/protocol/pi-rpc-compatibility.md` — 跨模块策略;要求兼容变更同批更新 `packages/pi-rpc/SPEC.md` 与受影响产品 SPEC
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md` / `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md` — `agent_settled` 语义归属说明

## Core Files — OMP 内部(`<OMP_NPM_DIR>/pi-coding-agent/…`)

- `src/modes/rpc/rpc-frame.ts` — 帧契约:1 MiB 行上限、`overflowFrame` 生成 "RPC response exceeded the transport limit"、`RpcFrameEncoder`(v1 裁剪 / v2 分片)、`RpcFrameDecoder`(客户端重组参考实现)
- `src/modes/rpc/rpc-mode.ts` — RPC 服务端:`ready` 帧、`negotiate_protocol`(仅接受 v2)、`get_available_commands`、`branch`、`get_state` 超集、`set_ask_dialog`、settle watcher 接线
- `src/modes/rpc/rpc-client.ts` — OMP 官方客户端:协商流程与分片消费的权威参考
- `src/modes/rpc/rpc-types.ts` — 帧/响应/命令类型全量(含 `RpcAvailableSlashCommand`)
- `src/modes/rpc/rpc-session-settle.ts` — `session_settled` 发射条件(每次活动期一次,静默后)
- `src/main.ts` — 启动装配:`hasUI = isInteractive || mode === "rpc-ui"`、`setToolUIContext` 仅 rpc-ui、`PI_NO_PTY`
- `src/tools/index.ts` / `src/tools/ask.ts` — `ask` 工具的门控(`cfgAskEnabled`、`AskTool.createIf` 依赖 hasUI)
- `src/slash-commands/available-commands.ts` — 可用命令来源分类(builtin/skill/extension/custom/mcp_prompt/file)
- `src/extensibility/extensions/get-commands-handler.ts` — 扩展 API 的 `getCommands()`(非 RPC 方法)
- `<OMP_NPM_DIR>/pi-agent-core/src/agent.ts`, `src/types.ts` — `agent_end` 发射与事件类型(`agent_settled` 不存在于 OMP)

## Core Files — 上游 Pi 对照(`<PI_CLI_DIR>/…`)

- `dist/modes/rpc/rpc-mode.js` — 对照:`get_commands` 的 `case`、`Unknown command` 默认分支
- `dist/bundle/chunks/*.js` — 对照:无 `rpc_chunk` / `maxFrameBytes` / `negotiate_protocol`(Pi 一行一消息、无上限声明)

## Navigation

- 要理解"为什么 resume 会失败" → `rpc-frame.ts`(`encodeRpcFrameFromJson`/`overflowFrame`)再看 `rpc-mode.ts` 的 `negotiate_protocol` 与 `output()` 的协议切换
- 要理解"客户端应如何协商与重组" → `rpc-client.ts` 的启动流程 + `RpcFrameDecoder`
- 要理解"回合结束语义" → `rpc-session-settle.ts` + `rpc-mode.ts` 的 `prompt_result`/`session_settled`,再对照仓库 `conversation-projection.SPEC.md` 的 settle 段
- 模块边界:仓库侧 `packages/pi-rpc` 拥有传输与方言,**不得**依赖 VS Code;`apps/vscode/src/extension` 拥有会话/投影/模型策略;二者只通过归一化契约交互
- 现有 OMP 兼容的散落点清单与归属 → `omp-rpc-dialect.LEGACY-COMPAT.md` 第 1 节表格

## Discovered Later

<!-- 追加式:实现过程中新发现的入口点/符号写在这里 -->
