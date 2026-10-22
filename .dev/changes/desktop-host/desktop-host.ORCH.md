# Desktop 副产品：整体推进脚本

目标与质量标准见 [TARGET-SPEC](desktop-host.TARGET-SPEC.md)。本脚本连接已完成结果、当前检查点、后续交付与待决定事项；规划本身不增加合并或发布授权。

## 整体路线与当前位置

```text
双端共享架构验证（已完成技术验收）
    ↓
预览体验与持久化取舍（当前：基础体验已反馈，修复兼容细节）
    ↓
日常使用闭环（把临时预览补成能持续使用的 App）
    ↓
主插件兼容与双产出维护验收
    ↓
独立桌面产物 → 首版总验收
```

这是当前选定的推进顺序，不是所有工作的硬依赖。主插件验证和维护检查可提前开展；每个节点的 `REQUIRES` 才表示必须已有的结果。自动验证贯穿后续变更，不是最后才测试。

**当前是“技术路线已打通的开发预览”，不是“Desktop 首版完成”。** 用户尚未确认预览的日常使用形态；持久 Project、设置入口、关闭/重开恢复和独立桌面分发尚未完成。

## 执行路线

[双端共享架构验证]
#DONE: 共享实现和两种宿主已经跑通，技术验收完成；不代表用户体验已验收。

客户端主体已迁入 `apps/pi-client`，同一份 UI、Runtime、Registry 和消息桥供两端使用。`src/host/clientHost.ts` 集中声明有限能力，VS Code 薄接线，Desktop 适配；原 CSS/class/Codicons/主题映射保留。Electron 已有多 Project/全部 Pi 导航，未另写聊天或会话管理器。

证据：checkpoint `7c3f671`；824 项测试、双端构建、VSIX 校验、受控 Extension Host E2E、两个无关 Project 的 Electron smoke 通过。一次共享 UI 文案修改已进入双产出。真实本机 Pi 1.1.0 的共享 Runtime 发送、Abort、历史恢复、阻塞输入通过。后续主目录修复 checkpoint `d0dbc29` 的完整检查为 828 项测试，增强的 Electron smoke 连续 3 次通过；新增主目录插件 E2E 尝试被系统 VS Code 更新锁阻塞，未算通过。GUI 自动化使用受控子进程，不能混称为完整真实 Pi GUI 验收。快照与证据限制见 [验证记录](refactor/desktop-client.RESULT.md)。

[预览体验与持久化取舍] << CURRENT
#IN PROGRESS: 用户反馈两端最基础功能似乎可用。主目录已修图标/搜索语义、Mermaid、共同样式入口、字体解析及 fixture 状态；设置默认值已从 VS Code manifest 生成共享模块，构建/测试检查防止分叉。该改动通过 829 项测试、双端构建及默认值变更反例检查，见 [验证记录](refactor/desktop-client.RESULT.md#设置默认值权威来源)。当前需确认首次导入/持久化约定，尚未读取真实 VS Code 设置或实现持久配置。
REQUIRES [双端共享架构验证]: 有真实可运行的候选，而非假页面。

基础体验反馈已收到，不要求用户重复技术检查。后续从主目录启动/复测：

```bash
pnpm --dir apps/desktop start
```

添加两个熟悉的目录，各 New 或 Resume 一个 Pi，切换查看。只判断：现有聊天/Header/输入框是否保持顺手；Project 与全部 Pi 导航是否适合替代终端多开；有没有缺少的关键操作或会话切换问题。不要求用户重跑技术检查或判断代码架构。

当前预览的 Project、设置和客户端元数据仅在内存，退出会停止子进程；设置入口和恢复功能未补齐。不要将它当作可依赖自动恢复的正式工作台。Pi 的会话文件仍由 Pi 保存。

IF 反馈是局部缺陷或布局组合问题
    在现有实现上修正并重验；不重新设计聊天客户端。
ELSE IF 新证据表明路线损害主插件或维护成本不可接受
    OPEN 调整方案、缩小范围或停止 Desktop：由用户决定，暂停受影响工作，不因已有投入强推。
END

OPEN 首版运行约定
    由 Agent 提出具体建议，用户确认影响使用的取舍，不让用户设计内部接口：
    - 配置与 Project/会话元数据的存储位置；首版是否提供 Project 级设置覆盖。
    - 首次从 VS Code 一次性导入的来源/范围：用户级显式设置还是当前窗口的有效配置。后续独立配置、不持续同步；范围未确认，不擅自读取用户设置。
    - 关闭窗口/退出 App 时如何处理运行中的 Pi；重开恢复哪些元数据、会话和草稿。
    这些决定供 [日常使用闭环] 使用。跨会话恢复规则不得由当前临时实现反推。

本节点的结果：用户认可基本使用方向，首版运行约定明确；不是要求预览已有全部首版功能。

[日常使用闭环]
#TODO: 交付能反复打开、持续使用的 Desktop，而非每次重新配置的演示窗口。
REQUIRES [预览体验与持久化取舍]: 已确认使用方向与运行约定。

- 按已确认约定保存/恢复 Projects、必要会话元数据及草稿，不另建对话数据库。
- 提供本机 Pi、通用设置与代理等必要设置入口；沿用 VS Code 键和共享默认值，明确不兼容项。配置改变不静默打断运行中的 Pi。
- 补齐日常 New/Resume、多 Pi 切换、待输入提示、错误恢复与关闭/重开流程；同一通用实现不分叉。
- 保留主题语言和窄窗可用性，明确首版主题支持范围；不将完整 VS Code 主题导入器变成本阶段前置任务。

验收：两个无关 Project 中真实 Pi 经常规 GUI 路径可并行使用；切换不丢草稿/串输入；退出及重开符合已确认规则；用户无需编辑源码才能完成必要配置。Agent 准备技术证据，用户只判断日常操作是否顺手。

[主插件兼容与双产出维护验收]
#TODO: 自动证据已有基础，仍需最终候选的插件实测与长期维护边界验收。
REQUIRES [双端共享架构验证]: 两端确实消费同一实现。本节点可在 Desktop 补全期间提前开展。

- 由 Agent 维护依赖/类型/兼容检查：通用 UI 改一处进入双端；客户端新增宿主依赖必须经过集中 interface；不兼容项显式暴露。
- 验证插件可独立构建和开发，无需启动 Desktop；VS Code 专属能力不受 Desktop 最低公共能力限制。
- 维护规则收齐后增加 `.agents/skills/dual-maintenance/SKILL.md`，说明改动分类、源码归属、适配与最小检查；引用 SPEC/实际命令，不另写一份架构政策，不替代机械检查。
- 在最终候选中回归插件的会话、工作区、编辑器标签页、草稿交接及 light/dark/high-contrast、280px 表现。Agent 自动验证；需要用户判断的部分提供候选和短检查项。
- 整合前核对 main；若 main 前进，必须同步实际施工代码并重验，不能只更新控制文档。

本节点的结果：主插件可继续正常开发/使用，双产出的适配责任有机械检查支撑。共享改造可单独申请主线整合，不必与 Desktop 发布绑定；未经用户批准不合并 main。

[独立桌面产物]
#TODO: 交付无需源码仓库和开发终端的 Desktop 产物。
REQUIRES [日常使用闭环] and [主插件兼容与双产出维护验收]: 使用闭环和主产品边界已经成立。

OPEN 首版发布平台及产物形式
    当前仅在 Windows 上验证。由 Agent 给出可执行程序/便携包或安装包的建议，用户确认目标；不默认承诺所有平台。

按确认范围打包，并从系统界面启动验证本机 Pi/外部 Node 定位、字体/图标/资源、配置位置及多 Project 流程。不能用 `pnpm start` 或终端继承的 PATH 代替这个检查。不自动加入 Pi 安装升级、远程服务、托盘常驻或自动更新。

[首版总验收]
#TODO: 交付 TARGET-SPEC 定义的 Desktop 副产品，而不只是一份安装包。
REQUIRES [日常使用闭环] and [主插件兼容与双产出维护验收] and [独立桌面产物]

Agent 对照 TARGET-SPEC 汇总可执行证据和明确限制；用户判断它能否替代实际终端多开的用法、插件是否仍然顺手。缺陷返回其所属节点修复。通过后再单独获得主线合并/发布授权，遵循版本与分支规范；checkpoint 不等于发布许可。

## 代码位置与接续规则

| 位置 | 用途 |
|---|---|
| 主目录，`feat/desktop-host` | **唯一施工入口**；`e2cdae9` 已 squash 整合 WIP，基础兼容 checkpoint `d0dbc29`，后续设置默认值收尾见 RESULT；控制脚本与 TARGET-SPEC 也在此维护 |
| `.worktrees/261019_desktop-bridge-inputs`，`wip/desktop-client` | 整合前的冻结回退点，不再施工；checkpoint `7c3f671`，前一 checkpoint `367d295` |
| `refactor/desktop-bridge-inputs@d551904` | 本轮施工前的 R1＋R2a 对照基线 |
| `.worktrees/261011_desktop-host-boundary` | 旧 R1 对照，不继续维护另一条候选 |

当前未合入 main、未改产品版本、未发布。施工中按可检查结果及时 checkpoint，避免长期大 working diff。其他分支的 ORCH 是快照；用 `git show feat/desktop-host:.dev/changes/desktop-host/desktop-host.ORCH.md` 取当前控制状态。

开发/验证命令见主目录的 `.dev/docs/development.md`、`.dev/docs/testing.md` 和 `apps/desktop/SPEC.md`。旧 R1/R2a 证据见 [原验证记录](refactor/ui-bridge-inputs.RESULT.md)；已退出活动目录的调研/Ticket/原型可从 `9a308d4` 追查，不作为当前指令。
