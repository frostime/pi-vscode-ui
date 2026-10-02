---
title: OMP RPC 方言分层 — 实现交接
created: 2026-10-02T12:37:31+08:00
consumed: false # 接收方读完请置 true
---

# OMP RPC 方言分层 — 实现交接

## Assume Reader

新会话的 Pi Coding Agent,将**接手实现**本任务(可能换机器、换更强的模型)。它能读取本仓库工作区、OMP 与 Pi 的安装包;它**无法**恢复本次会话的对话,也没有本机实测过程的记忆。

它必须同时拿到:

- 本文件;
- 仓库**当前分支 `fix/omp-minimal-support` 的工作区**,而不是仅 clone 主线——本任务的 change 文档已随该分支的最新提交入库;`packages/pi-rpc/src/protocol/RpcChunkAssembler.ts` 是**未接线**的草稿(第 2 步才接线);
- 可读的其他安装包:OMP(`<OMP_NPM_DIR>`,基线 `pi-coding-agent@18.4.9`)、上游 Pi(`<PI_CLI_DIR>`,基线 `0.99.1`)。

路径约定:仓库内路径相对 `d:/Arsenal/PlayCode/pi-vscode-ui`;`<OMP_NPM_DIR>` := 全局 node_modules 的 `@oh-my-pi` 作用域目录(本机 `D:/Envs/bun/install/global/node_modules/@oh-my-pi`);`<PI_CLI_DIR>` := 本机 `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent`。

## Background Context

触发:用户在 `oh-my-pi` profile 下发现两个症状——resume 大会话失败(`Unable to load conversation history: RPC response exceeded the transport limit`)、`/` 命令列表只剩 3 个本地命令。随后用户给出架构要求(见 User Guidance 原话):OMP 兼容不得与 Pi 代码混在一起,必须"有兼容的样子"。

已完成的调查与实测(派生结论、证据与不确定性标注全在 `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.LEGACY-COMPAT.md`,**不要重新验证**):

- OMP 单行上限 1 MiB;协议 v1 下超限**响应**被替换为上述错误,超限**事件**被静默裁剪;协商 v2 后才以 `rpc_chunk` 分片。
- 会话副本实测:2,108,760 B 会话,v1 报错;协商 v2 后 `get_entries` 成功(745 条目 / 约 2.5 MB)。
- OMP 回合结束发 `agent_end → prompt_result → session_settled`,**无 `agent_settled`**;上游 Pi 无分片/上限概念。

已对齐的架构(详见 DEV-SPEC 与 SHAPE):Pi 为主(合同语言取 Pi);两层归属(RPC 方言层 / 业务兼容层);同构判定四条件决定"翻译 vs 标记";每个差异只有一处归属。

## Current Status

- 目标:按 `omp-rpc-dialect.SHAPE.md`(status: accepted)实现,先修 resume,同时让 Pi 路径不再出现 OMP 字面量。
- 代码状态:**未开始**。工作区仅新增本次文档与一个未接线的 `packages/pi-rpc/src/protocol/RpcChunkAssembler.ts` 草稿。
- 已提交:`02405bb`(settle 修复,含会话层 `PI_OMP_ADAPTER`)与产品版本 `0.15.0-beta.3`(用户已安装该 VSIX)。注意该提交同时改过 `.dev/changes/runtime-compatibility/` 下的旧 DEV-SPEC,用户明确要求**本轮不动那个目录**。
- 阻塞:无。未决项只有命名与 `agent_end` 重试语义(见下)。

## Trajectory

**症状定位与 settle 修复。** 用户报告"回合已结束但红色停止按钮常亮、点击无反应";定位为 OMP 不发射 `agent_settled`,而回合状态机、live-stats 刷新、settle 后刷新都挂在它上面。已在会话层做事件投影并提交 `02405bb`(该投影在第 2 步要迁入 RPC 方言)。

**resume 上限问题。** 用户报告 resume 大会话报 "RPC response exceeded the transport limit";经抓流与源码定位到 OMP 的帧契约与协商机制,并用会话文件副本实测出 v1 失败 / v2 成功的对照。结论与证据固化为 LEGACY-COMPAT 的事实表。

**架构对齐(两轮)。** 用户先质疑 `pi-rpc` 是否只是消息层(答案:它已内建 Pi 方言),再提出"消息层同构翻译 + 能力差异打标记、业务层再兼容"的两层划分;据此确定 Pi 为主、四条件判据、每差异一处归属,并否掉了 `RuntimeAdapter` 命名与"Pi 代码里的 OMP 分支"写法。

**支持面收敛。** 用户决定本轮只保基础能力,tree/fork/slash 命令发现/运行时 tool UI 四类显式声明为不支持(slash 命令整类不做,理由是许多命令依赖 TUI、当前无法逐一分辨;skill 内容仍可经普通 prompt 使用)。

**文档产出。** 在新 change 目录 `.dev/changes/omp-rpc-dialect/` 写下 DEV-SPEC、SHAPE(accepted)、LEGACY-COMPAT、MAP(上下文地图)与本交接文档;旧 `runtime-compatibility/` change 目录保持不动。

## Key Information for the Successor

实现顺序(每步可独立发布、可测):

1. **零行为重构**:`packages/pi-rpc` 目录化为传输机制 + `dialects/pi`(现 `PiRpcApi`/`rpcTypes` 原样迁入)+ 归一化契约 + 工厂;导出面保持兼容,现有测试全绿。
2. **OMP 方言 + 机制**:传输层无条件支持分片重组(接线已有草稿);方言声明协议协商;把 `session_settled` 归一化为 `agent_settled`;同时**回滚** `02405bb` 中会话层的 `PI_OMP_ADAPTER`(其测试迁到 pi-rpc 方言测试)。
3. **契约化 app 侧**:运行时契约(进程/目录/设置归属/启动模式 + 能力声明),`sessionTree`/命令发现/tool UI 声明为 false;`SessionRuntime`/`SessionRegistry`/`resolvePiModelScope`/`SessionCatalog*` 改依赖契约。
4. **文档同批**:`packages/pi-rpc/SPEC.md`(Boundary 扩为"传输 + 方言")、`session-lifecycle.SPEC.md`、`conversation-projection.SPEC.md`、`.dev/docs/protocol/pi-rpc-compatibility.md`、`CHANGELOG.md`。
5. **验证**:单测 + `pnpm check` + 真实 OMP 冒烟(见下)+ 打包。

不要重新讨论或推翻的决定:合同语言 = Pi;同构四条件;每差异一处归属;不支持面必须显式声明(不得静默、不得露出后点击才报 `Unknown command`);不做中立词表 / 插件系统 / 能力矩阵;暂不拆独立 OMP 包(除非出现第三个方言)。

需要留意但未决:命名(归一化契约名、`dialects/` 目录名、标记字段名——`runtimeCompat` 是待定提案、业务层源码目录名);OMP `agent_end` 是否携带等价于 Pi `willRetry` 的重试信息(未验证,未验证前不要写进契约)。

验证配方:

- 单测:`pnpm --dir apps/vscode exec vitest run test/unit/<file>.test.ts`;`pnpm --dir packages/pi-rpc exec vitest run`。
- 全量:`pnpm check`(版本检查 + lint + typecheck + 单测 + build + bundle size)。
- 真实冒烟(**必须用会话文件副本**,在线会话正被当前会话进程持有):复制 `.omp/agent/sessions/<workspace-dir>/<session>.jsonl` 及其同名目录到临时目录 → `spawn omp --mode rpc --session <copy>` → `get_state` → v1 `get_entries`(应报 transport limit)→ `negotiate_protocol {protocolVersion:2}` → `get_entries`(应成功,条目数一致)。
- 打包:`pnpm package:vsix && pnpm verify:vsix`,产物 `artifacts/FrostPi-<version>.vsix`。

## User Guidance

作用域:仅本任务。引用原话以免转述漂移。

- "把对 OMP 的兼容和正常的 PI 代码混在一起,这是错误的架构,OMP 的兼容一定要有兼容的样子"。
- "先只支持最基本的正常对话、resume 等;高级的 tree, fork 和 slash command 暂时先不支持(可以在代码中先标记不支持),只支持 prompt + SKILL 指令"。
- 命名:要自解释(`RuntimeAdapter` 被否);宁可写多,也不要 inline 分支;新 change 文档放新目录,旧 `.dev/changes/runtime-compatibility/` 不动。

## File Reference Map

本任务产物(workspace-relative):

- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.DEV-SPEC.md` — 行为契约与验收
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.SHAPE.md` — 预测 diff 与归属迁移
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.LEGACY-COMPAT.md` — 散落兼容点、实测事实、缺口
- `.dev/changes/omp-rpc-dialect/omp-rpc-dialect.MAP.md` — 代码导航索引

代码(待改):`packages/pi-rpc/{SPEC.md,src/PiRpcConnection.ts,src/PiRpcApi.ts,src/protocol/rpcTypes.ts,src/protocol/RpcChunkAssembler.ts}`、`apps/vscode/src/extension/{configuration/runtimeCompatibility.ts,sessions/SessionRuntime.ts,sessions/SessionRegistry.ts,models/resolvePiModelScope.ts,sessions/catalog/SessionCatalog.ts}`。

跨模块策略与模块 SPEC:`.dev/docs/protocol/pi-rpc-compatibility.md`、`apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`、`apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`。

OMP 内部(完整导航见 MAP):`<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-frame.ts`(帧契约/溢出/分片)、`.../rpc-mode.ts`(服务端握手与各命令)、`.../rpc-client.ts`(官方客户端协商与重组参考)、`<OMP_NPM_DIR>/pi-agent-core/src/agent.ts`(事件发射)。

对照:`<PI_CLI_DIR>/dist/modes/rpc/rpc-mode.js`(Pi 的 `get_commands` 与 `Unknown command`)及其 bundle(无分片/上限)。

## Context Map

已按 `write-task-context-map` 规范产出独立文件:`.dev/changes/omp-rpc-dialect/omp-rpc-dialect.MAP.md`(含本任务核心文件、OMP 内部入口、导航路径、模块边界)。接手时先读它,再读 SHAPE。

最关键的 4 个 OMP 入口(无 MAP 时的最小定位集):

- `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-frame.ts` — 为什么会报 transport limit、v2 如何分片
- `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-client.ts` — 客户端应如何协商与重组(权威参考)
- `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-mode.ts` — `ready`/`negotiate_protocol`/`get_available_commands`/`branch`/settle 接线
- `<OMP_NPM_DIR>/pi-coding-agent/src/modes/rpc/rpc-session-settle.ts` — `session_settled` 的发射条件

## Clarifications & Discussion

接收方若发现缺漏、歧义或阻塞,在此追加问题;用户可切回作者会话作答。

| # | 接收方问题 | 作者答复 |
|---|---|---|
| | | |
