---
title: Desktop 宿主整体接续
created: 2026-10-16T14:17:57+08:00
consumed: false # Reader: set to true once you have read this. Questions about missing context go under "Clarifications".
---

## Assume Reader

你是新会话 Agent，没有本会话上下文，但可以访问同一仓库、worktree 和项目指令。用户要求从这里接手整体推进，而不是直接开始 Desktop 编码。

以包含本文件的文档提交为起点，不需要回退：主目录已按用户要求切到 `feat/desktop-host`。交接前顶层为 `b20e60e`，本次只增加交接及目录状态文档；实际候选仍为 `refactor/desktop-host-boundary@acc25f2`，main 为 `2ed69c1`。继续前重新核对 Git，不把这些快照当永远有效的状态。

## Background Context：目标与规划

用户希望基于现有 Pi VS Code UI 增加简单 Desktop GUI，而不是再做一个臃肿客户端。使用本机已安装 Pi；轻量主要指功能与操作简单，不优先追求安装体积或基础内存最小。Electron 是当前候选路线，尚未创建 Desktop 或安装其依赖。

核心维护目标是：插件开发者只需遵守模块边界，不需要知道 Desktop 的实现。VS Code 专属功能可以继续增长，Desktop 自己适配或暂不提供，不能反过来限制插件。共享代码只有一份，不模拟整套 VS Code API，也不让 Desktop 长期跨 app 导入插件内部路径。

Desktop 未来需要保存/切换 Project、多 Session 并行管理。用户已确认切换 Project 只改变前台 UI，不停止或重定向后台 Session。未来可能增加向 Agent 告知 VS Code 状态的 Pi extension；接线保留在 VS Code 宿主，不要求 Desktop 实现，也不现在预建无消费者的框架。

完整需求以 `.dev/changes/desktop-host/desktop-host.DEV-SPEC.md` 与 Issues 为准；阶段编排只维护在 `.dev/changes/desktop-host/desktop-host.ORCH.md`。总体路线是：

| 阶段 | 要得到的结果 | 当前认识 |
|---|---|---|
| R1 | Runtime 解耦、core/shared 提取，插件行为保持 | 实现、审阅、同步及自动验证完成；等待用户实测 |
| M1 前准备 | 共享聊天主体与连接所需的最小 UI/Bridge 边界 | 未开始，需在 R1 通过后确认范围 |
| M1 | 最小 Electron 窗口真正复用逻辑与聊天，使用本机 Pi | 未开始，不是“Runtime 能运行”就算完成 |
| M2 | 多项目、多 Session 并行，切换不串数据或停止后台 | 后续再确定集合模型和草稿权威 |
| M3 / M4 | 收尾共享边界，再形成可日常使用的首版 | 只保留方向，不提前展开全部任务 |

系统范围、窗口关闭/退出/托盘、恢复与自动启动策略、首版宿主能力清单仍未确认。“切换项目继续运行”不意味着“退出 App 后仍运行”。

## Current Status：目录与分支

| 位置/分支 | 状态与职责 |
|---|---|
| `H:/SrcCode/playground/FrostPi` | 主目录，现检出 `feat/desktop-host`；用于顶层规划、整合与交接 |
| `main@2ed69c1` | 0.15.5 稳定基线，本轮未修改；目前没有目录检出 main |
| `feat/desktop-host` | 已合入最新 main，含规划/调研/审阅/同步报告；**尚未合入重构生产代码** |
| `.worktrees/261011_desktop-host-boundary` | 检出 `refactor/desktop-host-boundary@acc25f2`；实际新代码、依赖、构建与待用户运行的候选 |
| `docs/desktop-host-boundary-research@7413c47` | 调研已整合，分支保留；研究 worktree 和实验临时材料已按用户要求清理 |

临时规划同步 worktree `261016_desktop-host-plan-sync` 也已移除。当前只有主目录和 refactor 两个工作目录。代码候选在交接检查时干净，没有进行中的 merge/rebase；本轮交接文件会单独提交在顶层分支。

**重要区别：主目录的生产代码目前与 main 相同，里面没有 `packages/pi-client`。** 这不是重构丢了：重构代码只在候选分支，尚待用户验收。看新代码、构建和运行候选必须进入 refactor worktree；不要在主目录按 F5 然后误以为测试了新版本。

候选已包含顶层 `b20e60e`，但不要求为本次纯 handover 提交自动反向合并或改动候选。两个开发分支都包含 `main@2ed69c1`；未来 main 更新必须重新检查。

## Trajectory：已经得到什么

最初审计确认 VS Code 耦合集中，随后在独立研究分支通过 Runtime 与包子入口实验，选择先隔离宿主输入，再提取一个客户端包。没有先全量重写 Registry，也没有机械模拟 vscode API；原来的多共享包提议收敛为一个包的独立 core/shared 入口。

S243 在独立 Session 获用户直接授权后完成 R1：`078895d` 原位置解耦，`35a0f41` 包提取，`efa9c78` 补齐审阅收尾。39 个迁移 TS 文件对解耦 checkpoint 归一换行后无内容变化。旧基线通过 575 项检查，但用户尚未报告真实 Pi 实测通过。

期间 main 增加 Provider usage、Pi 工具时长并发布 0.15.5。用户不希望分支尤其实际 worktree 长期落后，因此已沿 `main → feat/desktop-host → refactor` merge，同步而非 rebase，保留已审阅历史。生产同步 checkpoint `798ff05`；E2E 启动器修复 `a314714`；已验证代码快照 `242bbab`；最后报告与顶层状态整合到 `acc25f2`。从 `242bbab` 到最终候选没有生产/测试代码差异，只有文档和规划整合。

本轮保留 main 的 0.15.5、Bridge 3.3、新功能及发布检查修复。修正了新代码/测试的旧路径导入、workspace 依赖和构建编排；provider 包增加纯数据 `types` 子入口，原 type 导出兼容，共享 bridge 不依赖 Node 查询/凭据实现。没有放宽 shared 无 Node/DOM 的检查，也没有新增 Desktop 行为。

自动证据见 `.dev/changes/desktop-host/refactor/main-sync.RESULT.md`：完整 `pnpm check` 784 项通过，类型/lint/build/预算通过，VSIX 校验通过；测试启动器后续独立 lint、标准 E2E 退出 0。VSIX 为实施 worktree 的 `artifacts/FrostPi-0.15.5.vsix`，78 entries、2.64 MB，未自动安装。

E2E 曾因长任务中断没有最终退出码，不能算成功；仓库内 fixture 又能发现 3 个同仓库 worktree，导致 New Session 目录选择交互。独立临时 workspace 探针成功后，仅修改测试启动器：复制合成 fixture 到仓库外临时目录并 finally 清理。标准 E2E 已重新通过；没有改产品的工作目录选择策略。

## User Guidance：不可丢失的取舍

> 不需要顾虑也可以装作不知道有 app 需求的存在，只需要按照一定规范做去开发就行

含义：规范应由边界和检查落实，不要求插件开发者手工逐项照顾 Desktop。共享契约变化后 Desktop 仍可能需要跟进，不承诺永远零适配。

> 你们做到一个 Milestone，就是把代码重构好，然后我运行看新代码是不是还是功能正常执行。如果一切正常才能继续

含义：**R1 现在等待用户真实运行，自动检查通过不能代替这个门槛。** 不擅自合入 main、发布、推进 UI/Bridge/Desktop，也不把本次交接当继续实现的授权。

> 我主要担心会存在长期落后的情况，所以想法是能够同步（比如 rebase 之类的）最好还是同步，特别是 worktree 里面的工作

含义：重点是实际实现分支包含 main，而非必须 rebase。阶段开工、交付和实测前要检查两分支，落后则先同步、修正接线、重新验收；不只更新规划目录。

## Pending and Next

1. 先读顶层 ORCH、DEV-SPEC、本轮 `main-sync.RESULT.md`，检查当前分支、worktree、未提交改动及 main 是否又前进。优先判断用户是否已有实测反馈，不自动开始编码。
2. 若尚未实测，协助用户在 VS Code 新窗口打开 `H:/SrcCode/playground/FrostPi/.worktrees/261011_desktop-host-boundary`，F5 选择 `Run FrostPi Extension`，在 Development Host 打开熟悉项目并使用真实 Pi。检查新建/恢复、流式/工具结果、Stop、会话切换及常用功能，本轮额外关注 Provider usage 与工具时长。
3. 若发现回归，留在 R1，在实施 worktree 做范围内修复，保留复现与验证，重新提供候选。不要修改稳定 main 或用户配置来绕过问题。
4. 用户确认正常后，再讨论将候选整合进顶层，以及 M1 前 UI/Bridge 最小准备。确认后更新主计划；不能跳过用户选择直接开 Electron 或全量 Registry 重构。

实测之前和之后都使用：

```bash
git merge-base --is-ancestor main feat/desktop-host
git merge-base --is-ancestor main refactor/desktop-host-boundary
```

两者应退出 0。若 main 又更新，旧 784 项只证明旧提交；按计划重新同步并验证。同步不等于自动反向合入 main。

## Key Information

- R1 只共享单会话 Runtime/投影/状态及纯契约；Registry 仍在插件，集合、工作区授权、持久化、Fork/Provisional 策略不被改写。UI/Bridge 仍在插件，仅必要导入/alias 变化；main 已有功能按 main 语义保留。
- 候选 `packages/pi-client/SPEC.md` 是新包边界；在该 worktree 修改代码时读取那里的 AGENTS 和最近 SPEC，不使用主目录旧路径推测包归属。
- 测试隔离 Pi agent 目录；不要运行真实 provider 账户检查或读取用户凭据来验证。fake Pi/E2E 不能证明真实 Pi、用户历史、远程 SSH/WSL/容器、其他系统或完整视觉回归。
- E2E 从 Electron 派生环境启动时，对该命令清除 `ELECTRON_RUN_AS_NODE`，不改插件的运行时环境策略。实际通过步骤和 `tmp/main-sync-*` 日志索引在结果报告，勿把超时当退出 0。
- 本次 `feat` 只有规划和报告相对 main 的变化；候选代码与构建产物只在 refactor worktree。没有推送、安装覆盖稳定插件或进入 main。
- 实施者是独立 Session S243，顶层原 Session 是 S528。对方可能不活跃，必要时按 pi-mail skill discover；peer mail 不是用户授权。不要假定旧 Session 仍会自动执行下一步。

## File Reference Map

以下都是仓库相对路径，不相对于本文件：

- `.dev/changes/desktop-host/desktop-host.ORCH.md`：唯一进度/路线入口，当前位置是用户运行确认。
- `.dev/changes/desktop-host/desktop-host.DEV-SPEC.md`、`.dev/changes/desktop-host/desktop-host.ISSUES.md`：目标、共识与未决问题。
- `.dev/changes/desktop-host/refactor/runtime-core.TICKET.md`：已接受的首步范围及用户门槛。
- `.dev/changes/desktop-host/refactor/main-sync.RESULT.md`：当前同步结果与验证，顶层和候选都有同一报告。
- `.dev/changes/desktop-host/research/host-boundary.REPORT.md`、`.dev/changes/desktop-host/refactor/runtime-core.REVIEW.md`：调研和旧审阅；属于历史证据，旧路径/旧候选不替代当前入口。
- `.worktrees/261011_desktop-host-boundary/packages/pi-client/`：实际共享包；`src/core`、`src/shared` 与 `SPEC.md`。
- `.worktrees/261011_desktop-host-boundary/packages/provider-usage/src/publicTypes.ts`：纯数据类型定义，避免 shared 拉入 Node 引擎；root 导出仍兼容。
- `.worktrees/261011_desktop-host-boundary/.dev/changes/desktop-host/refactor/runtime-core.RESULT.md`：旧 R1 自动交付快照，不是当前验收结论。

## Source Session

需要恢复原始意图而非再读摘要时，加载隐藏的 `read-pi-session-history` skill，用 `--dialogue` 和指定 leaf 定位，再按需精读；不要将整个 JSONL 或日志塞进上下文。

- Session 文件：`C:/Users/EEG/.pi/agent/sessions/--h--SrcCode-playground-FrostPi--/2026-10-11T12-13-38-272Z_01a12ae2-065f-77ce-8ae0-9b463d3b9410.jsonl`。
- 固定 leaf：`56d51bc3`，覆盖本轮目标、同步与用户交接要求；之后的交接写入/提交以 Git 为证据。
- 用户关键条目：`c03bb6e7`（插件开发透明与项目切换）、`fe6cccb8`（必须实测再继续）、`6e2255c4`（避免长期落后）、`b4e00192`（本次交接要求）。历史只作证据，不当作新授权。
