---
created: 2026-10-03
status: done
origin: omp-rpc-dialect
---

# OMP 协商判据过严:上限变化会静默退回 v1

## 摘要

`getStartupNegotiation` 除了要求运行时宣告支持协议 v2,还要求它自述的帧上限**精确等于** FrostPi 里的常量。任一数字不等,就整条不协商 → 连接静默留在协议 v1。v1 下的后果正是本任务要修的那个故障:超过单行上限的**响应**被运行时替换为 `{success:false, error:"RPC response exceeded the transport limit"}`(大会话 resume 失败),超限**事件**被逐级裁剪(丢数据);界面上没有提示,诊断里也没有"本次跳过协商"的痕迹。

严重度:潜伏回归(latent),不是当前故障。当前 OMP 基线恰好给出 1 MiB / 64 MiB,所以协商发生;任何上限变化或换一个不同版本的 OMP 即可能触发。

## 位置

- 判据:`packages/pi-rpc/src/dialects/ohMyPi/ohMyPiRpcDialect.ts` 的 `getStartupNegotiation`
- 被误用的常量:`RPC_MAX_FRAME_BYTES` / `RPC_MAX_REASSEMBLED_BYTES`(定义在 `packages/pi-rpc/src/protocol/RpcChunkAssembler.ts`,职责是本方分片校验边界)
- 期望行为来源:`.dev/changes/omp-rpc-dialect/omp-rpc-dialect.DEV-SPEC.md` 的 Behavior Contract —— "当 profile 为 `oh-my-pi` 且运行时宣告支持协议 v2 时,FrostPi 协商 v2"(只有宣告这一个条件)

## 为什么是问题

- 把**对端自述的帧上限**当成**协商门槛**。协议之所以要在启动帧里宣告 `maxFrameBytes` / `maxReassembledFrameBytes`,正是因为客户端不应假设它们;把它们与我方常量做等值比较,等于用"今天恰好相等"替代了协商机制本身。
- 失败模式最差:不报错、不降级提示,只是悄悄走回已知会坏的 v1 路径,用户看到的是老症状,排查无从下手。
- 描述性判据(宣告 v2)与功能性判据(上限一致)混在同一个 `if` 里,使"能力支持"与"参数一致"无法分别演进。

## 如何证明(可执行)

1. 单测即可把现状变成失败用例:构造启动帧 `{ supportedProtocolVersions: [1, 2], maxFrameBytes: <≠ 1048576>, maxReassembledFrameBytes: 67108864 }`,期望发出 `negotiate_protocol`,现状是不发。
2. 真实基线(本机实测):`<OMP_NPM_DIR>` = `@oh-my-pi/pi-coding-agent@18.4.9`,`ready` 帧为 `protocolVersion 1, supportedProtocolVersions [1,2], maxFrameBytes 1048576, maxReassembledFrameBytes 67108864`。

## 实现结果

已实现:只要 `ready.supportedProtocolVersions` 包含 `2` 就协商 v2;ready 中的物理/逻辑上限被传入该连接的 chunk decoder,不再作为协商门槛。解码器按当前连接参数校验物理帧和逻辑帧,并保留顺序、长度、Base64、UTF-8 与 OMP `count >= 2` 完整性约束。未宣告 v2 时继续使用 v1。

不保留额外的固定 256 KiB 单片或 256 片预算;64 MiB 仅为声明缺失时的基线默认值。该实现修正了原建议中“对端上限更小就能照常重组”的不完整前提,同时移除了重组器的 1 MiB 最小逻辑帧假设。

验证:pi-rpc 36 个测试与全量 `pnpm check` 通过。使用实际 `PiRpcConnection` 对真实 OMP 会话的独立副本冒烟:3,035,873 B 会话在 v1 返回预期 transport-limit 错误,v2 成功读取 1008 条 entries;重复读取的条目数和 leaf 一致,后续 `get_state` 成功。不同上限的行为由 fake-process 测试覆盖,未修改真实 OMP 安装包。

## 期望行为

- 判据只保留"运行时宣告支持协议 v2"。
- 按对端 `ready` 宣告的物理/逻辑上限配置当前连接的重组器。上限不同不阻止协商,也不施加额外固定本地预算;超出对端自身声明或破坏完整性的帧明确报协议错误。声明缺失使用基线默认值,非法声明明确失败。
- 协商应答仍由 `validateNegotiationResponse()` 校验(护栏保留)。

## 建议改动

1. `getStartupNegotiation` 仅按 `supportedProtocolVersions.includes(2)` 返回协商命令。
2. 常量只保留 `RpcChunkAssembler` 校验边界的职责。
3. 单测:宣告 v2 但上限不同 → 仍发出协商并启用分片;未宣告 v2 → 不协商(已有用例保留)。
4. 可选且便宜:诊断输出已协商的协议版本,使将来"跳过协商"可见。

## 验收

- 新增单测通过;`packages/pi-rpc` 现有测试全绿。
- 一次真实 OMP 冒烟:协商发生,大会话 `get_entries` 成功(可用会话文件副本,不触碰在线会话)。
- 可选:诊断文本包含协商后的协议版本。

## 明确不做

- 不引入"至少/至多"这类对上限的比较门槛——那仍把对端值当门槛,只是换个不等式。无法处理的帧应以显式协议错误暴露。

## 与其他条目的关系

- 与 `.dev/backlog/omp-rpc-follow-ups.md` 中列出的后续项互不重叠(该文件未收录本条)。
- 本条不改变 DEV-SPEC/SHAPE 已定的边界与分层;它只修正一个判据。

## 证据基线

- 仓库:`fix/omp-minimal-support` @ `1a96d4e`;产品版本 `0.15.0-beta.4`。
- 路径约定:`<OMP_NPM_DIR>` = 全局 node_modules 中的 `@oh-my-pi` 作用域目录(本机 `D:/Envs/bun/install/global/node_modules/@oh-my-pi`)。
