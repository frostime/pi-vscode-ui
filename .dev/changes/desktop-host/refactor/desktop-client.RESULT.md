# 共享客户端与 Desktop 开发预览验证

## 候选与范围

- 实现：`wip/desktop-client@7c3f671`，位于 `.worktrees/261019_desktop-bridge-inputs`；前一 checkpoint 为 `367d295`。包含本地 `main@2ed69c1`，未合并 main、未改产品版本、未发布。
- `apps/pi-client` 的现有 UI、Runtime、Registry 和消息桥供两个产出实际消费。宿主需求集中在 `src/host/clientHost.ts`，VS Code 薄接线，Desktop 适配。
- Desktop 是内存态开发预览：Project、设置和客户端元数据不跨应用重启保存。配置路径、Project 配置覆盖与正式关闭/恢复策略仍未定。

## 自动与原生宿主检查

| 检查 | 结果 |
|---|---|
| `pnpm check` | 通过：全部 lint/typecheck、125 个测试文件 / **824 项测试**、双端构建、插件 bundle budget |
| `pnpm package:vsix && pnpm verify:vsix` | 通过：0.15.5，78 entries，2.65 MB；未安装到用户宿主 |
| `env -u ELECTRON_RUN_AS_NODE pnpm --dir apps/vscode test:e2e` | 通过：受控 Extension Host 退出码 0；测试宿主 VS Code 1.142.0 |
| `pnpm --dir apps/desktop test:smoke` | 通过：实际 Electron 44.9.0、两个无关临时目录、两个受控 Pi 子进程；共同 UI/New/消息渲染、并行执行、Stop 隔离、前台/cwd 归属和 renderer 无 Node/原始 IPC |
| 通用 UI 修改传播 | 共享空状态文案由 “Start a Pi session” 改为 “Start or resume a Pi session”，两个实际 JS 产物均包含新文案；9 份原有 CSS 内容与基线相同 |

Svelte 保留基线中的一条可访问性警告（ExtensionUiRequestCard 的条件 tabindex），构建保留入口 chunk 提示；没有通过放宽预算或跳过测试来通过 gate。E2E 的下载版 VS Code 有自身 workbench/worker 诊断输出，测试 runner 及 Extension Host 均退出 0。

两路独立只读审查后，修复了 Resume 搜索/Browse 可见性、远程目录 URI 保留、Electron 文件过滤转换、输入错误保留/可纠正、原生 API 类型及错误反馈。外部链接仍由共享分派器限制为 HTTP(S)。

## 真实本机 Pi

本机 `pi --version` 为 **1.1.0**。使用同一份已构建 SessionRuntime，在新建临时目录和指定临时 session-dir 中完成：

- 启动并刷新命令元数据；用临时扩展产生真实 RPC confirm 请求，拒绝后 pending 清零。
- 发送最小真实模型请求，检查 assistant response 中的预期标记；未将提示、回复或凭据写入 FrostPi 日志/本报告。
- 启动另一轮后 Abort，确认退出 streaming 且 Runtime 未失败。
- 停止进程，按同一 Pi session file 创建新 Runtime 并加载历史，确认原回复恢复。

结果全部通过。Pi 仍拥有会话文件；未修改用户项目或设置。验证关闭了自动扩展/skill/template 发现及 MCP，显式加载临时输入扩展；这不证明所有用户扩展组合。**真实 Pi 证据来自共享 Runtime；Electron GUI 路径的自动化使用受控子进程，两份证据不能混称为完整真人 GUI 验收。**

临时证据：gate 日志 `G:/Enviroment/msys2/tmp/frostpi-gates.eJz95L/`；最终 Desktop smoke 的结果/截图在 `C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-ok5mYD/`；真实 Pi 结果在 `C:/Users/EEG/AppData/Local/Temp/frostpi-real-pi-6Wfr3w/`。这些是当时证据，不是运行依赖。

## 尚未证明

用户日常操作的布局/流程满意度、完整真实 Pi GUI 路径、所有用户扩展组合、Desktop 持久化/重开恢复和其他平台尚未验收。不能把此 checkpoint 宣称为 Desktop 产品完成或发布就绪。
