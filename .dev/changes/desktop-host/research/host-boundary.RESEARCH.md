# 首步重构：宿主边界专项调研说明

本文件是调研输入和交付要求，不是已完成报告，也不批准生产代码改动。主执行入口是 [顶层计划](../desktop-host.ORCH.md)。

## 调研要支持的决定

确定第一步重构的范围：如何隔离宿主依赖并组织可复用代码，既让 Desktop 真正使用现有实现，又不使插件开发者承担 Desktop 适配或复杂工程组织。

优先比较以下两种组织方式，允许证据支持更小的组合：

1. 原位置先建立薄宿主接口和稳定入口，再逐步提取。
2. 提取一个客户端共享包，包内区分 Node 后端、浏览器 UI 和通信定义，用明确子入口导出。

此前的后端/UI/契约三包提议已不作为默认方案。只有一个共享包存在已证实的依赖隔离或构建问题时，才展开分包替代方案，说明新增工程成本并提交用户判断。

包装整个 vscode API 作为模拟环境仅作为反例分析，不是默认方案。候选一可以是迁移顺序，候选二可以是最终组织；不把它们误当成同一轴上的互斥选项。

## 分支与范围

调研分支：`docs/desktop-host-boundary-research`，从顶层 `feat/desktop-host` 的规划提交切出。

本轮仅预创建分支。正式启动调研后，在这里提交调研报告、证据和必要的计划修订；不直接完成重构。需要技术实验时，先说明决定性问题，以最小、可逆实验回答；临时脚本及输出放 Git-ignored tmp，不混入生产源码。

调研结论回到顶层供用户确认。确认后另开重构分支，不能因“子分支已经存在”推导出允许实施。

## 已有证据及其限度

基线为 `main` 提交 `8c88f21`。前一轮只读审计对项目自己的 `apps/*/src` 源码统计到 30 个直接 vscode 导入文件，其中 3 个显式类型导入。测试、node_modules 和下载的 VS Code fixture 不计入。

当前判断是源码层面可行：RPC 已独立，状态/投影和大部分 Svelte UI 可复用，宿主耦合较集中。没有运行 Desktop、构建候选共享包或进行重构后的回归；不得把此判断报告为已验证迁移成功。

### 直接导入的完整分组

下表路径相对于 `apps/vscode/src/extension/`。每个文件只列一次，共 30 个；正式调研应在新基线上复核。

| 分组 | 文件 | 初步处理方向 |
|---|---|---|
| 启动与命令 | `activate.ts`、`commands/registerCommands.ts` | VS Code 端保留 |
| 会话 | `sessions/SessionRegistry.ts`、`SessionRuntime.ts`、`SessionPersistence.ts` | 混合职责拆分；Persistence 是显式类型依赖 |
| 会话选择 | `sessions/catalog/SessionCatalogPicker.ts`、`sessions/tree/SessionTreePicker.ts` | 交互目的与 VS Code 原生 UI 分开 |
| 配置 | `configuration/readConfiguration.ts`、`workspaceScope.ts`、`configurePiExecutable.ts` | 解析可共享，作用域与向导留宿主 |
| 代理 | `network/ProxySecretStore.ts`、`configureProxy.ts` | Store 是显式类型依赖；交互向导留宿主 |
| 诊断 | `diagnostics/DiagnosticLogger.ts`、`exportDiagnostics.ts` | 脱敏与日志接口分离；输出/保存留宿主 |
| 编辑器引用 | `composer/mentions/captureActiveFile.ts`、`captureSelection.ts`、`editorMentionSpecials.ts`、`workspaceFileSearchContext.ts` | 编辑器特例可选；普通搜索与通用加权保留 |
| 编辑器功能 | `composer/ComposerExternalEditor.ts`、`conversation/openReferencedLocation.ts`、`file-changes/GitBaseContentProvider.ts` | Desktop 可暂不提供，不删除插件实现 |
| 状态栏 | `status-bar/SessionStatusBar.ts` | VS Code chrome 保留 |
| 视图外壳 | `webview-host/PiViewProvider.ts`、`SessionPanelManager.ts`、`createWebviewHtml.ts`、`SessionWebviewCoordinator.ts` | 拆出同步部分，保留侧边栏/标签页策略 |
| 连接与动作 | `webview-host/WebviewConnection.ts`、`WebviewActionDispatcher.ts`、`webviewTypes.ts` | 端点、授权、通用动作与宿主动作分开；Types 是显式类型依赖 |
| 草稿缓存 | `webview-host/ComposerDraftCache.ts` | EventEmitter 可替换，草稿规则保留 |

### 优先复核的语义耦合

- [SessionRuntime](../../../../apps/vscode/src/extension/sessions/SessionRuntime.ts) 的直接 VS Code 调用是版本与代理读取。但它还从 [DiagnosticLogger](../../../../apps/vscode/src/extension/diagnostics/DiagnosticLogger.ts) 运行时导入脱敏函数；仅删除两处调用不能消除间接依赖。代理来源须保持启动/重启时读取。
- [SessionRegistry](../../../../apps/vscode/src/extension/sessions/SessionRegistry.ts) 混合会话集合、ExtensionContext、原生交互、通知和工作区策略。`activateSession` 会清理未提交新会话；工作目录校验依赖打开的工作区。不能直接拿它们实现 Project 切换。
- [WebviewEndpoint](../../../../apps/vscode/src/extension/webview-host/webviewTypes.ts) 仍直接持有 vscode.Webview。[WebviewConnection](../../../../apps/vscode/src/extension/webview-host/WebviewConnection.ts) 读取 VS Code 字体配置并发警告，不是已完成的宿主无关接口。
- [Dispatcher](../../../../apps/vscode/src/extension/webview-host/WebviewActionDispatcher.ts) 混合目标授权、快照相关交互、会话动作和编辑器/设置动作。保留验证与请求关联，不以删除授权简化移植。
- [Composer](../../../../apps/vscode/src/webview/features/composer/Composer.svelte) 用 sidebar/panel 控制命令与草稿恢复；[本地命令列表](../../../../apps/vscode/src/webview/features/composer/frostPiCommands.ts) 固定包含 `/editor`。需要明确能力与策略，而非加入 isDesktop 分支。
- [App.svelte](../../../../apps/vscode/src/webview/App.svelte) 根据展示列表清理批注；跨项目过滤不等于 Session 删除。草稿、异步结果和请求状态也需追踪实际拥有者。
- [vscodeBridge](../../../../apps/vscode/src/webview/bridge/vscodeBridge.ts) 是浏览器通信入口；另有主题变量、Mermaid 主题/资产路径、CSP 和 codicon 资产依赖，不能只查 import。
- 本机 Pi 同样会加载用户/项目配置的扩展。VS Code 专属扩展若全局安装，Desktop 也可能加载；两端均使用 RPC，不能凭 RPC 模式识别 VS Code。

## 必须阅读的契约与构建入口

- [架构](../../../docs/architecture/overview.md)、[开发流程](../../../docs/development.md)、[测试策略](../../../docs/testing.md)。
- [会话生命周期](../../../../apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md)、[Bridge](../../../../apps/vscode/src/shared/bridge/webview-bridge.SPEC.md)。
- [Composer](../../../../apps/vscode/src/webview/features/composer/composer.SPEC.md)、[文件引用](../../../../apps/vscode/src/extension/composer/mentions/file-mentions.SPEC.md)。
- [Pi RPC](../../../../packages/pi-rpc/SPEC.md)、[现有包入口](../../../../packages/pi-rpc/package.json)。
- [workspace](../../../../pnpm-workspace.yaml)、[VS Code tsconfig](../../../../apps/vscode/tsconfig.json)、[esbuild](../../../../apps/vscode/esbuild.config.mjs)、[Vite](../../../../apps/vscode/vite.config.ts)、[根构建](../../../../scripts/build.mjs)、[质量检查](../../../../scripts/quality.mjs)、[ESLint](../../../../eslint.config.js)。

## 调研必须回答的问题

- 哪些是简单的配置/存储/日志注入，哪些是生命周期或展示策略，不能机械封装？
- 首条共享链路具体需要迁移哪些模块？哪些留在插件，哪些暂时不迁移？
- 插件与 Desktop 通过什么入口使用同一份代码？类型检查、Svelte/CSS/资源构建和最终打包是否支持该入口？
- 一个共享包能否保持 Node 与浏览器依赖隔离？若不能，是什么具体依赖使拆包成为必要，而非为了结构整齐？
- 如何保持插件自己的开发命令不依赖 Electron？共享包测试如何避免继续 mock vscode 才能运行？
- 第一步是否需要触碰 Registry 或 sidebar/panel 协议？如果需要，如何保护当前行为、标识契约变化并限制改动范围？
- 宿主怎样提供专属 Pi 扩展启动信息，而不建立通用插件平台或让共享核心读取 VS Code 状态？

## 交付要求

形成 `host-boundary.REPORT.md`，按以下内容组织：

1. 结论、证据等级和会改变建议的未决问题。
2. 候选对比及推荐；模块归属、依赖方向、导出/构建方式和实际开发流程。
3. 首步重构预测：相关文件、改动性质/规模、明确不动的部分及分步迁移方法。
4. 验证方案：宿主依赖检查、局部行为测试、插件构建/集成和最小 Desktop 运行路径。
5. 需要用户决定的范围/行为选择，与可由执行者决定的实现细节分开。

用户应能从报告决定是否开始首步重构。交付不要求解决完整 App 的平台、安装包、托盘或全部能力列表；只有它们确实改变近期边界时才提升为当前阻塞。
