# R2a：UI/Bridge 原位宿主输入解耦

## 授权与目标

用户允许在 R1 人工验收前先检查后续卡点；无需新增产品决定的部分可以提前实施，次日提供验收。R1 仍未通过，原候选 `refactor/desktop-host-boundary@acc25f2` 保留。

本段减少聊天代码对宿主的隐式依赖，不改插件行为。入口是[主计划](../desktop-host.ORCH.md)，约束以 DEV-SPEC 和现有模块 SPEC 为准。此段不是 Desktop、共享 UI 包或 M1 完成。

## 最小范围

- 浏览器 Bridge 不再在模块导入时调用 `acquireVsCodeApi`。启动入口显式连接传输；缺失宿主不能静默空发。业务组件不查询 VS Code 全局 API。
- Host Connection 只消费最小消息收发、可见性和释放端点，不持有整个 `vscode.Webview`。VS Code 字体设置、旧 fd 提示由插件接线提供，保持原读取与提示时机。
- 聊天内部确有生产用途的宿主输入原位显式化：Host-local 命令、Provider Usage 数据源、发送失败草稿恢复责任。Sidebar/Panel 继续消费同一 SessionInteraction，不预建统一 HostService、完整能力枚举或 `isDesktop` 分支。
- 对关键边界添加行为测试，保留现有功能回归；同步最近 SPEC 和必要的架构说明。

选择按宿主输入拆职责，而非整棵 App 搬迁：前者隐藏真正的宿主决定，后者会把工作区、集合过滤和草稿清理规则一并误当通用行为。暂不拆新包；完成原位隔离后，再用实际消费者验证物理共享边界。

## 保持不变

Bridge 3.3 及双向消息格式、schema/version/目标授权、快照与增量送达缓存、隐藏恢复、requestId、Provider usage 取消与缓存、sidebar/panel 选择与草稿权威、Fork/tree/批注/阻塞输入、Registry 与持久化、主题/CSP/字体/Mermaid 产物位置均保持。

不创建 Electron，不定义 Project 集合或 Desktop 草稿保留，不决定关闭/退出/托盘/恢复，不实现未来 VS Code 状态扩展。遇到必须改变这些行为才能继续的情况，暂停该部分并报告；不以技术默认值代替用户决定。

## 工作位置与验证出口

从 R1 候选建立 `refactor/desktop-bridge-inputs`，worktree 为 `.worktrees/261019_desktop-bridge-inputs`。main 不变；原 R1 worktree 保留可运行。顶层规划仅合入文档，生产准备代码不自动回流 main 或顶层。

完成条件：

1. 既有 sidebar/panel 使用新输入；无遗留旧 Bridge 全局初始化或兼容空实现。
2. 局部测试证明显式传输能发送/接收同一协议，订阅释放和重新挂载正常；Host 授权、失败送达恢复、草稿交接及相关聊天行为不退化。
3. 类型、lint、完整测试、构建、VSIX 与受控 E2E 按可用环境验证。阻塞或未执行项如实列出，不挪用 R1 结果。
4. 独立审阅新增差异；结果记录候选、日志与未验证项，提供次日可操作的人工验收入口。

R1 真 Pi/历史验收、UI 视觉/输入法/资源及本段新增交互仍需用户运行确认。未确认前不合入 main、不发布、不安装覆盖稳定插件。
