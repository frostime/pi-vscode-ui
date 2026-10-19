# Desktop 副产品：接续入口

先读 [TARGET-SPEC](desktop-host.TARGET-SPEC.md)。它定义目的、已确认架构和完成标准；本文只记录代码位置与执行状态。

## 当前代码

| 位置 | 用途 |
|---|---|
| 主目录，`feat/desktop-host` | 控制文档；生产代码与本地 `main@2ed69c1` 相同 |
| `.worktrees/261019_desktop-bridge-inputs`，`wip/desktop-client` | **唯一施工入口**；从 R1＋R2a 候选 `d551904` 继续 |
| `refactor/desktop-bridge-inputs@d551904` | 本轮施工前的可回退基线 |
| `.worktrees/261011_desktop-host-boundary` | 旧 R1 对照，不继续维护另一条候选 |

控制状态只在 `feat/desktop-host` 维护。其他分支同名文件是快照，可用 `git show feat/desktop-host:.dev/changes/desktop-host/desktop-host.ORCH.md` 读取当前入口。开工前核对 Git，生产候选必须包含最新本地 main；本轮未授权合入 main 或发布。

已有 R1/R2a 主要是搬迁与宿主输入隔离，不需要从 main 重写。共享 UI 尚未提取，Desktop 尚未创建。重新检查的 client/插件类型检查及 127 项针对性测试通过；Svelte 有一条可访问性警告。宿主内存打包实际解析共享源码；尚无真实桌面运行证据。更早证据见 [验证记录](refactor/ui-bridge-inputs.RESULT.md)，不替代本轮验收。

## 执行路线

[现有客户端＋集中宿主接口＋Desktop 适配] << CURRENT

1. #TODO: 将客户端从 `packages/pi-client` 归入 `apps/pi-client`，继续使用同一源码；更新解析、依赖检查、测试和构建，不改变插件行为。
2. #TODO: 将现有通用会话集合、消息分派/同步和 UI 纳入客户端入口。集中声明实际需要的 VS Code 形状的宿主能力；插件薄接线，Desktop 适配。不重写 Registry、聊天或 New/Resume，不设计完整 VS Code SDK 兼容层。
3. #TODO: 建立 Electron 薄宿主，提供必须的目录、配置、选择/确认、主题变量与消息传输。增加多 Project/全部 Pi 导航，尽早用两个无关目录验证共享链路，而不是先完成广泛准备性重构。
4. #TODO: 验证插件独立构建/运行、共同 UI 进入双产出、多 Pi 并行与切换归属；再跑真实 Pi 的发送/停止/历史恢复/阻塞输入。未获得的证据明确留空，不把受控 fixture 当真实 Pi 验收。

## 执行约束与停点

- 保留现有 Header、会话动作、CSS/class/Codicons 和主题变量约定。Desktop UI 只补宿主缺口与项目导航，不从 HTML 原型恢复旧设计。
- 配置定义不手抄两份；Desktop 的 `vscode` 代理模式明确不支持。配置具体路径、Project 覆盖、退出/重开恢复仍不能由实现默默定案。
- 技术阻塞先做小范围验证；若需改变目标、插件行为或引入显著额外运行机制，暂停该部分并说明取舍。一般构建、路径和适配问题自行解决。
- 本轮可实施和建立 checkpoint，但不提前宣称产品完成、不合并 main、不发布。需要用户验收时提供真实候选与短检查项。

旧调研、Ticket、SOP 与 handover 可从 `9a308d4` 的 Git 树追查，不作为当前执行指令。
