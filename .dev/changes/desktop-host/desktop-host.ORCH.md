# Desktop 宿主：顶层计划

这是本 change 的唯一推进入口。先读 [目标与边界](desktop-host.DEV-SPEC.md)，按需查阅 [Issues](desktop-host.ISSUES.md)、[首步边界调研说明](research/host-boundary.RESEARCH.md) 和 [调研报告](research/host-boundary.REPORT.md)。不要把本计划当作已生效的模块契约。

新会话先读 [R2a 结果](refactor/ui-bridge-inputs.RESULT.md)和[次日验收 SOP](refactor/ui-bridge-inputs.SOP.md)。[R1 整体交接](handover/R1-desktop-host-continuation.HANDOVER.md)保留历史目录与原始会话定位，其暂停规则已被用户允许延后验收、先做准备的后续授权更新；当前状态以本文件为准。

## 目标与成功判断

在现有 Pi VS Code UI 基础上增加简单 Desktop GUI，使用本机 Pi，支持项目管理与跨项目 Session 并行。插件开发者只需遵守模块边界，不需要知道 Desktop 的实现，也不需要为每项插件功能完成两端适配。

成功不只是 Electron 能启动 Pi：两端应实际复用一份会话逻辑与聊天主体，插件保持可独立开发、构建和使用；项目切换只改变前台，不改变后台会话运行。

用户已接受首步范围：Runtime 薄宿主输入解耦，再提取一个共享客户端包的 core/shared；Registry 仅接线，不模拟整套 VS Code API，不在首步改变集合、UI 或 Bridge 策略。完整 UI/集合组织仍待后续验证，不预先批准大规模拆包。

## 当前证据

边界专项调研已形成 [报告](research/host-boundary.REPORT.md)。除源码和契约复核外，临时 Runtime 实验在无 vscode mock 的 Node 中跑通受控 Pi 对话；临时包子入口实验编译了现有 App.svelte、共享样式与字体，并检查 Node/浏览器依赖图隔离。现有相关基线测试共 86 项通过。

旧 R1 候选 `efa9c78` 已完成 Runtime/core/shared 提取和当时基线的自动审阅，历史证据见 [REVIEW](refactor/runtime-core.REVIEW.md)。main 后续已发布 0.15.5，旧候选不包含 Provider usage 和 Pi 工具时长新功能，因此不能继续当作最新实测版本。

已按 `main@2ed69c1` 同步顶层与实际 refactor worktree。生产合并 checkpoint 为 `798ff05`，E2E 收尾为 `a314714`，已验证代码快照为 `242bbab`；后续仅追加计划/结果文档。完整检查 784 项、VSIX 和标准 E2E 均通过，见 [本轮结果](refactor/main-sync.RESULT.md)。main 本身不改。用户随后允许在人工验收前先推进无产品决策卡点的准备工作；R1 实测延后，不记为通过。新增工作单独交付，不覆盖 R1 候选。

R2a 原位 UI/Bridge 宿主输入解耦已交付：生产实现 `45a2e72`，已验证代码快照 `eb05c72`。完整检查 120 文件、799 项、VSIX 和标准 E2E 均通过，独立静态审阅无新增发现，见 [R2a 结果](refactor/ui-bridge-inputs.RESULT.md)。现在等待用户在新增 worktree 验收 R1 核心链路和本段补测；没有创建 Electron 或共享 UI 包，不把 M1 标为完成。

## 分支与变更归属

| 分支 | 用途 | 接续方式 |
|---|---|---|
| `feat/desktop-host` | 顶层集成分支 | 最初从 `main@8c88f21` 切出，已合入 `main@2ed69c1`；主目录现按用户要求检出此分支，用于顶层规划和交接 |
| `docs/desktop-host-boundary-research` | 已完成的调研分支 | `7413c47` 已整合到顶层；用户同意移除研究 worktree，分支与提交保留 |
| `refactor/desktop-host-boundary` | R1 首步重构与自动验证 | `.worktrees/261011_desktop-host-boundary@acc25f2` 保留为原候选对照 |
| `refactor/desktop-bridge-inputs` | R2a 原位 UI/Bridge 准备与当前验收候选 | 从 R1 候选切出，再合入顶层 `cd32f60` 文档；独立 worktree `.worktrees/261019_desktop-bridge-inputs`，包含 R1 |

Git 没有自动的父子分支关系，这里的“子分支”指从顶层指定提交切出，并将结果整合回顶层。调研结论只以文档结果回流；不能把实验或未经确认的生产改动顺带合入。

用户允许先完成可回退、无需新增产品取舍的准备检查点，次日再实测；原 R1 人工验收不免除。研究和阶段报告整合到顶层；生产代码只在独立实施分支交付，不自动进入顶层或 main。推送、发布及新增 Desktop 产品行为不在本段范围。

S243 已在其独立 Session 获得用户直接授权并完成候选交付；peer mail 仅传递上下文。S528 负责主计划、独立审阅及用户检查点。用户已同意清理完成调研的 worktree 和临时实验材料；先安全移除目录链接，再用 Git 移除研究 worktree。报告及复核方法仍保存在顶层和研究提交中。实施 worktree 保留；`efa9c78` 是历史检查点，原 R1 候选以同步结果为准保留；当前包含后续准备的验收候选见 R2a 结果，等待用户实测。不安装 Desktop 依赖。

## 推进路径

### 近期：R1 插件行为保持的重构检查点

[启动边界专项调研]
#DONE: 已完成源码/契约复核、两个临时实验和局部基线测试，交付 [调研报告](research/host-boundary.REPORT.md)。生产源码未改。

报告建议原位置先做薄宿主输入，再提取一个客户端包的 core/shared。Registry 只调整创建接线，不在首步改变侧边栏/标签页、草稿或生命周期策略。包入口实验提供可行性证据，正式 workspace 与迁移后检查仍是重构验收内容。

[确认首步重构边界]
#DONE: 用户已接受报告首步范围；提出必须先运行新插件确认功能正常，再继续。

REQUIRES [启动边界专项调研]: 已审阅的报告和决定性实验材料。

研究结果提交 `7413c47` 已通过顶层审阅并整合。保留报告中的证据限度：Runtime/包实验不是正式类型隔离、重构回归或 M1 成功证明。

[首步重构]
#DONE: S243 在实施 worktree 交付干净候选 `efa9c78` 与 RESULT；职责解耦、共享包提取、自动验证及两项审阅收尾完成。仅指代码与自动交付完成，R1 仍待用户实测。

REQUIRES [确认首步重构边界]: 已接受的最小范围和验证方案。

S243 按 [R1 Ticket](refactor/runtime-core.TICKET.md) 完成原位置解耦、core/shared 提取、插件接线、相关测试与打包。结果包含候选提交、实际检查证据、未验证项及用户运行步骤，不复制研究报告当作重构验证。

出现状态、协议、作用域或其他实质范围变化时暂停并报告，不混入这次依赖清理。不要为未来功能预建无消费者的接口。

[R1 独立审阅]
#DONE: 核对两个实现 checkpoint、39 文件机械迁移、包/构建与测试/契约，未发现阻塞性生产问题。动态代理测试和根 clean 两项已补齐并增量复核；结论和证据见 [REVIEW](refactor/runtime-core.REVIEW.md)。

REQUIRES [首步重构]: 干净的候选提交和 `runtime-core.RESULT.md` 的自动验证证据。

S528 审阅职责改动、机械迁移、依赖方向和证据；发现问题返回实施者范围内修复。自动验收通过后提供候选 worktree 供用户运行，不启动下一阶段。

[R1 同步 main]
#DONE: 两分支包含 `main@2ed69c1`，合并已提交；784 项完整检查、VSIX 和标准 E2E 退出 0。额外只读审阅及类型/导入复核无剩余阻塞。结果见 [main-sync.RESULT](refactor/main-sync.RESULT.md)，采用 merge 保留历史。

REQUIRES [R1 独立审阅]: 已知的重构边界和旧候选检查点。

保留 main 的 0.15.5、Bridge 3.3、Provider usage、工具时长和发布检查修复；保留 pi-client 的职责和目录。冲突解消之外，还需修正新代码的旧路径导入、共享数据类型边界、依赖/构建/测试入口。所有检查在实际 refactor worktree 运行，不把主目录或旧候选结果作为新候选证据。

[R1 用户运行确认]
#WAITING: 同步 0.15.5 后的新候选已就绪，在 `.worktrees/261011_desktop-host-boundary` 用 F5 的 `Run FrostPi Extension` 运行，具体步骤和反馈模板见 [R1 人工验收 SOP](refactor/R1-manual-test.SOP.md)。仍待真实 Pi 及常用功能反馈，尤其 Provider usage、工具时长。现在建议按 [R2a SOP](refactor/ui-bridge-inputs.SOP.md)在新候选一次覆盖两段，回归时再用原 R1 对照。用户允许先做下一段准备，不代表本项已通过。

REQUIRES [R1 独立审阅] and [R1 同步 main]: 可由用户运行的新候选、最新基线验证和确切启动步骤。

用户最初要求确认插件功能正常后才能继续；在新增两路静态审阅未发现具体回归后，用户明确允许先检查后续卡点，无卡点的部分可以先做，次日再交付验收。当前采用这项更新授权：准备工作可并行，R1 仍未通过。发现回归则优先修复并重新验收。main 和已安装插件不被自动替换。

OPEN 用户对候选版本的实际运行反馈。
    自动测试通过、静态审阅、构建成功或代码提交均不能替代这项反馈。提前推进仅限不需要新增产品取舍的可回退工作，不把“先做”当作 R1 验收。

IF 用户确认候选行为正常，且决定继续
    核对 R1 与 R2a 反馈，按用户决定整合已接受结果，再讨论共享 UI 物理提取及 M1 的下一段范围。
ELSE IF 用户发现回归
    返回 [首步重构] 修复，保留原反馈和修复证据，再次独立审阅与实测。
ELSE IF 用户明确允许延后验收并先推进
    保留原候选，另开准备分支；先处理不改变产品行为的边界。遇到产品决策卡点则暂停该部分，次日提供独立验收范围。
ELSE
    保持候选和证据，停在用户检查点，不自动继续。
END

### M1：最小纵向版本

[M1 前 UI/Bridge 准备] << CURRENT
#WAITING: [R2a 原位宿主输入解耦](refactor/ui-bridge-inputs.TICKET.md)已实现并验证，见 [RESULT](refactor/ui-bridge-inputs.RESULT.md)。当前在 `.worktrees/261019_desktop-bridge-inputs` 按 [SOP](refactor/ui-bridge-inputs.SOP.md)等待用户验收。R1 对照保留；共享 UI 提取、资源边界和 Electron 仍未完成，本段到可验收检查点停止。

REQUIRES [R1 用户运行确认] 或用户明确允许延后验收：本轮采用后者，后续验收不免除。

R2a 已让浏览器消息传输、Host 端点以及聊天组件实际使用的宿主输入显式化，现有 sidebar/panel 是生产消费者。协议版本、授权、会话集合、草稿权威、批注清理、资源布局和持久化不改。范围与出口见 Ticket，具体证据与未验证项见 RESULT。

Project 集合、Desktop 草稿/批注生命周期、首版能力和退出规则仍未确认。它们不阻塞原位依赖清理，但不得被准备工作默认为产品决定。共享 UI 的物理提取和最小 Electron 链路在本段证据后再评估。

[M1 最小纵向验证]
#TODO

REQUIRES [R1 用户运行确认]: 用户确认插件行为正常并决定继续。
REQUIRES [M1 前 UI/Bridge 准备]: 真正共享的聊天主体与消息连接；Runtime 提取本身不满足此条件。

交付一个最小 Desktop 窗口，实际复用会话运行、对话投影和聊天组件。使用本机 Pi 验证消息发送、流式结果、停止及恢复已有历史；检查共享组件、样式和资产确实进入两端产物。

验收时提供：实际复用关系、运行/构建证据、插件行为验证、仍然独占于宿主的代码，以及已经发现的迁移成本。只启动 Pi 或复制旧实现不算完成。

ASSUME Electron 能以可接受的改动复用当前 Node 后端与 Svelte 聊天主体。
    在本阶段验证 GUI 启动环境、本机 Pi 定位、通信及资源构建。
    IF 假设获得证据，且原插件保持可用
        由用户检查体验并确认继续，再估算多项目阶段的投入。
    ELSE
        暂停扩大功能，判断问题是宿主接线还是共享边界；回到相应上游节点，不静默更换目标或重写客户端。
    END
END

### 后续阶段：到达检查点后再细化

[M2 多项目多会话闭环]
#TODO

REQUIRES [M1 最小纵向验证]: 真正共享的运行链路及用户继续决定。

方向：至少两个 Project 的 Session 同时运行；切换前台不停止、删除或重定向后台会话，结果、草稿和输入请求不串 Session。进入前再确定项目/集合关系、保存范围和选择策略，不提前冻结模型。

[M3 完成共享边界]
#TODO

REQUIRES [M2 多项目多会话闭环]: 实际使用暴露的边界与状态需求。

方向：收尾 Registry、Bridge、UI 外壳和能力声明，加入依赖约束，验证插件既有工作区/远程、Fork、树导航、临时会话、标签页和草稿交接合同。此阶段不是首步之前的强制全量重构。

[M4 可日常使用的首版]
#TODO

REQUIRES [M3 完成共享边界]: 两端边界与兼容性证据。

方向：项目保存与恢复、基础配置、错误反馈、主题及安装包。进入前由用户确认系统范围、应用生命周期和首版能力清单；验证实际使用，不承诺全部插件功能等价。

DEFER
    具体窗口布局、打包格式、托盘、额外管理功能及完整日程，在相关阶段证据足够后再决定。
    若其中任何选择提前影响共享边界或外部行为承诺，将其提升为 OPEN，并与用户确认。
END

## 避免长期落后的同步规则

阶段开工、候选交付和用户实测前，先确认顶层、R1 和当前 R2a 实施分支包含当前本地 main：

```bash
git merge-base --is-ancestor main feat/desktop-host
git merge-base --is-ancestor main refactor/desktop-host-boundary
git merge-base --is-ancestor main refactor/desktop-bridge-inputs
```

三条命令都应退出 0。main 更新后若任一检查不通过，先做一次明确的同步、解决语义接线并重新验证，再报告候选可用。worktree 不会自动跟随 main；不要只更新主目录或规划分支而留下实际实现分支落后。同步默认先 `main → feat/desktop-host`，再显式同步到实际实施分支；R2a 已基于 R1。原候选作为旧提交对照时应保留确切提交，不把旧验证当作新 main 的证据；当前运行候选必须包含最新本地 main。不自动把候选反向合入 main。

这是一项工作检查点，不是定时自动合并机制。每次记录实际 main 基线、候选与验证范围；旧审阅和测试只证明旧提交。

## 结果回流与接续

每阶段记录产物位置、实际检查结果、未验证项和改变路线的新事实。执行状态及 `<< CURRENT` 只在本文件维护；Issues 记录问题，DEV-SPEC 记录共识，调研报告记录证据，互相链接而不复制多份进度。

后续 Agent 从本文件的当前位置接续，先检查分支/工作区与依赖证据是否仍成立。计划只安排准备如何推进，不增加执行授权。

代码或正式边界变化时，在同一改动更新最近模块 SPEC 与必要的跨模块文档。change 完成前，将长期知识迁入权威位置；本目录的归档或删除须经用户同意。
