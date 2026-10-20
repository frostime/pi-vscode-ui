# Desktop 副产品：接续入口

先读 [TARGET-SPEC](desktop-host.TARGET-SPEC.md)。它定义目的、已确认架构和完成标准；本文只记录代码位置与执行状态。

## 当前代码

| 位置 | 用途 |
|---|---|
| 主目录，`feat/desktop-host` | 控制文档；生产代码与本地 `main@2ed69c1` 相同 |
| `.worktrees/261019_desktop-bridge-inputs`，`wip/desktop-client` | **唯一施工入口**；已验证 checkpoint `7c3f671`；前一 checkpoint 为 `367d295` |
| `refactor/desktop-bridge-inputs@d551904` | 本轮施工前的 R1＋R2a 基线 |
| `.worktrees/261011_desktop-host-boundary` | 旧 R1 对照，不继续维护另一条候选 |

控制状态只在 `feat/desktop-host` 维护。其他分支同名文件是快照，可用 `git show feat/desktop-host:.dev/changes/desktop-host/desktop-host.ORCH.md` 取当前入口。开工前核对 Git；候选须包含最新本地 main。尚未合入 main、改变产品版本或发布。

## 已实现与证据边界

- 客户端主体已迁入 `apps/pi-client`：同一份 UI、Runtime、Registry、消息分派/同步和 Pi 扩展产物源码供两端消费。`src/host/clientHost.ts` 集中声明有限宿主能力；插件薄接线，Desktop 适配。现有 CSS/class/Codicons/主题映射保留。
- `apps/desktop` 已有 Electron main/preload、同源 ClientApp、多 Project/全部 Pi 导航及选择/输入弹窗。**这是明确标记的开发预览**：Project、设置和客户端元数据仅在内存，启动器使用临时 Electron profile。关闭预览会停止其子进程；持久配置路径和正式关闭/重开策略仍未决定。
- 已取得实际 Electron＋受控 Pi 子进程的证据：两个无关 Project、两个 Pi 并行，现有 New 与聊天渲染、前台切换/cwd 稳定、Stop 隔离、renderer 无 Node/原始 IPC。不是 HTML 原型，也不是实际模型/历史验收。
- 独立审查问题已修复。完整 `pnpm check` 的 824 项测试/双端构建、VSIX 打包校验、受控 Extension Host E2E 和修复后的 Desktop smoke 全部通过。实际证明一次共享 UI 文案修改进入双产出，9 份原 CSS 未改。
- 同一共享 Runtime 已在真实本机 Pi 1.1.0 上验过发送、Abort、进程重建后的历史恢复和 RPC 阻塞输入；真实 Pi 与受控 GUI 的证据边界见 [本轮验证记录](refactor/desktop-client.RESULT.md)。

## 当前工作

[预览体验与持久化取舍] << CURRENT

1. #TODO: 用户检查现有 UI 加薄 Project 外壳是否符合日常多开的用法，并走完整真实 Pi GUI 路径；自动化结果不替用户判断操作是否顺手。
2. #TODO: 确认持久 Project/设置的存储位置、Project 配置覆盖首版范围和正式关闭/重开策略，再实施。当前内存预览不能冒充这些决策已完成。
3. #TODO: 按需要补齐 Desktop 设置入口、主题/平台验证及剩余宿主适配；不扩大为整个 VS Code SDK 兼容。

开发/验证命令见候选内 `.dev/docs/development.md`、`.dev/docs/testing.md` 与 `apps/desktop/SPEC.md`。旧 R1/R2a 证据见 [原验证记录](refactor/ui-bridge-inputs.RESULT.md)。本轮最终检查见上述验证记录；预览不等于产品完成。

## 继续时的约束

不重写聊天、Header/New/Resume 或另建 Desktop Registry；不恢复已移除的 HTML 原型。配置不手抄两份，`vscode` 代理模式在 Desktop 明确不兼容。一般构建/适配问题自行解决；涉及目标、插件行为、持久数据或后台机制的新取舍要暂停确认。只在施工分支 checkpoint，不合并 main、不发布。

旧调研、Ticket、SOP 与 handover 可从 `9a308d4` 的 Git 树追查，不作为当前执行指令。
