# 首步重构：宿主边界调研报告

本报告支持“是否开始插件准备性重构”的决定，不批准接口或实现。目标见 [DEV-SPEC](../desktop-host.DEV-SPEC.md)，调研要求见 [RESEARCH](host-boundary.RESEARCH.md)，推进状态只维护在 [ORCH](../desktop-host.ORCH.md)。

## 1. 结论与证据

**建议推进，但不要把“准备插件”做成一次全量宿主化。先解耦完整单会话 Runtime，再提取一个共享客户端包的 `core` 与 `shared` 入口。Registry 只调整 Runtime 创建接线；首步不重写其集合、工作区和侧边栏策略，不改变 sidebar/panel 协议。**

原位置薄接口与共享包不是替代方案：前者决定依赖如何隔离，也适合作为迁移顺序；后者决定谁拥有实现、两端怎样导入。推荐组合是“先隔离，再迁移”，不包装整套 VS Code API，不让 Desktop 长期跨目录导入插件内部文件。

此建议优化两种成本：插件功能修改不需要同时理解 Desktop；共享实现的边界不能靠开发者记住每个间接导入维持。接受的代价是部分通用文件移入一个包、调整测试与构建接线。当前没有证据要求拆成三个新包。

### 本轮证据

基线为规划提交 `05c1de6`，生产代码对应 `main@8c88f21`。研究在 `docs/desktop-host-boundary-research` 的独立 worktree 完成；未改生产源码、依赖清单或锁文件，未安装 Electron。

| 证据等级 | 实际结果 | 能支持的判断 |
|---|---|---|
| 源码与契约复核 | 项目 `apps/vscode/src` 仍有 30 个直接 vscode 导入文件；Runtime 的本地静态导入闭包（含类型）为 34 文件，其中 4 文件依赖 vscode | 问题集中，但不能仅删除 Runtime 的直接 import；静态清单不是完整构建证明 |
| Runtime 临时实验 | 原 Runtime 在禁止解析 vscode 时构建失败；替换宿主读取点后，真实依赖图构建成功，metafile 有 46 个输入且无 `workspaceScope`/`DiagnosticLogger`；普通 Node 使用已有 fake Pi 完成启动、流式工具结果、持久化身份接管及停止，无 vscode mock | Runtime 可以在不迁移 Registry 的情况下独立运行；46 输入含 RPC/第三方代码，不是预计移动文件数 |
| 包入口临时实验 | 一个临时包的 core、shared、UI、styles 子入口能被消费者解析；实际复制的 `App.svelte` 编译成功，浏览器图不含 Runtime/RPC 进程模块，Node 图不含 Svelte/CSS；共享样式和 `./assets/codicon.ttf` 正确输出 | 同包的独立子入口可隔离 Node 与浏览器；现有 Vite/Svelte 工具链能编译跨包组件与 CSS/字体 |
| 现有局部测试 | Runtime/OMP/Registry/脱敏/代理 5 文件 45 项；Bridge/schema/连接/Dispatcher/Coordinator/草稿 6 文件 41 项，均通过 | 86 项是迁移前基线，不是重构回归或 Desktop 成功证据 |

临时实验只在 Git 忽略的 `tmp/` 写入。运行环境是 Windows、Node `v24.12.0`、pnpm `10.13.1`、已有 Vite `8.1.5` 与 esbuild `0.28.1`。复用主工作区已有依赖，没有在研究 worktree 安装依赖；基线测试也在相同提交的主工作区执行。实验与测试使用隔离的 `PI_CODING_AGENT_DIR`，不读取真实用户 Pi 配置。

**尚未验证**：正式 pnpm workspace 链接、候选包完整类型检查/typed lint、迁移后的插件构建与 VSIX、Extension Host/远程运行、真实本机 Pi、Electron GUI 环境和 UI 实际交互。UI 编译实验不是完整聊天体验验收，也未验证 Mermaid vendor 拷贝或主题视觉效果。

会改变建议的事实：正式候选包若无法在独立 tsconfig/子入口约束下隔离依赖，先调整入口与配置；只有出现无法在同包解决的具体构建/依赖冲突，才讨论分包。若首步必须改变 Fork、Provisional 或草稿规则，应拆出专项设计，不能混入依赖清理。

## 2. 候选方案与推荐归属

### 两个分解维度

- **宿主能力与产品策略**：Runtime 消费配置、日志、凭据及启动信息；工作区授权、原生交互、前台选择和草稿交接由对应宿主产品拥有。按这个维度拆职责，而不是按 vscode API 名称逐项包装。
- **运行环境与代码归属**：同一个客户端包内分别提供 Node core、纯 shared、浏览器 UI；两个 app 分别装配。物理入口保证消费者不会无意加载另一环境。

| 方案 | 对日常修改的影响 | 隐藏了什么 / 留下什么 | 判断 |
|---|---|---|---|
| 在 apps/vscode 原位置建立薄接口 | 最初接线变化小，易保护插件行为 | 隐藏宿主调用；Desktop 若长期直接导入该目录，仍依赖插件目录、alias 和构建 | 推荐作为迁移第一段，不作为长期两端依赖方式 |
| 隔离依赖后提取一个包、多个子入口 | 通用功能改一份代码，宿主专属功能只改 app | 包拥有 Runtime/投影/类型；宿主保留目录、交互及窗口决策。增加一套包级检查 | 推荐最小长期组织；UI 入口在需要共享聊天时再迁入 |
| 模拟 vscode API | 初期可机械替换调用 | 没有隐藏工作区、标签页、临时会话等产品知识，Desktop 要解释这些概念 | 不推荐；尤其不能保留 Registry 的切换删除规则来实现 Project 切换 |
| 同时拆 core/UI/contracts 三包 | 环境能通过包隔离 | 新增包清单、构建顺序与开发跳转；目前没有决定性收益 | 不作为首步方案 |

调试路径保持直接：app 创建 Runtime → core 启动 RPC → core 投影 → app 连接推送 ViewModel。宿主错误查 app 的配置/交互实现，流式和历史错误查 core，帧和请求错误查 pi-rpc。不额外增加一层通用 Controller 或插件管理器。

### 建议归属

| 归属 | 内容 | 首步动作 |
|---|---|---|
| `packages/pi-rpc` | 子进程、帧、请求及 dialect | 原样复用，不把产品逻辑塞进这里 |
| 候选 `packages/pi-client/core` | Runtime、Entry/ViewState、ConversationProjection 及辅助模块、ExtensionUiCoordinator、Pi 设置读取、模型范围、代理环境计算、OMP 产品兼容、tree/Question 私有桥 | 隔离宿主依赖后迁移 Runtime 实际需要的闭包，不删现有 Pi/OMP 功能来减小范围 |
| 候选 `packages/pi-client/shared` | Runtime 与消费者共同使用的 ViewModel、图像输入类型、Question 协议及 bridge 版本/消息定义 | 类型与协议保持单一来源；无 Node/vscode/Svelte 运行时依赖，纯校验库可用 |
| `apps/vscode` | Registry、工作区/Git 目录授权、配置来源、SecretStorage、OutputChannel、选择/确认/通知、VS Code 启动和视图外壳 | 保留；仅调整 Runtime 的装配及共享导入 |
| 首步仍在 `apps/vscode` 的 UI/连接 | Svelte、浏览器 bridge、Dispatcher、Connection、Coordinator、DraftCache | 暂不移动；共享类型改变位置时改导入，不改行为 |
| 后续 `pi-client/ui` 与连接模块 | 聊天组件、浏览器状态与消息同步中的通用部分 | M1 前按真实消费者迁入，不能把整个 VS Code 外壳直接当共享 UI |
| 未来 `apps/desktop` | Project 管理、Electron IPC、配置/存储、窗口及能力实现 | 本轮不创建 |

其中 [RuntimeCompatibility](../../../../apps/vscode/src/extension/configuration/runtimeCompatibility.ts) 是 Pi/OMP 产品兼容，不是宿主能力表；[proxyConfiguration](../../../../apps/vscode/src/extension/network/proxyConfiguration.ts) 的既有 `vscode` 模式也不需在首步改名。保留插件的配置与序列化契约，Desktop 不提供该模式即可；不能把“无 vscode 导入”误解成“所有类型都必须删除 VS Code 专属取值”。

## 3. 薄接口的具体范围

以 [SessionRuntime](../../../../apps/vscode/src/extension/sessions/SessionRuntime.ts) 的构造、`refreshConfigurationState`、`#startInternal` 为主要切口。

| 当前依赖 | 建议传入的最小内容 | 需要保护的时机/语义 |
|---|---|---|
| `configurationProvider` | 继续返回当前配置的函数 | 已有注入点可以保留；不必为每项 setting 创建接口。首步不拆出另一套 Desktop 配置模型 |
| `readVsCodeProxy` → `workspaceUriForPath` | 由插件实现的 `readHostProxy()` | 刷新 restart-required 状态和启动时读取；不能构造时缓存。保留当前目录/URI 查找行为，不顺带修订作用域策略 |
| `extensions.getExtension` 读取版本 | 创建 Runtime 时提供客户端版本值 | 保留已有 `PI_INSIDE_FROSTPI` 与版本标记的插件行为；不再由 core 查询扩展注册表 |
| 具体 `DiagnosticLogger` + 同模块脱敏函数 | Runtime 用到的日志接口；独立纯脱敏模块 | Runtime 实际只调用 `error`/`info`。OutputChannel、诊断头、show/dispose 留插件；保持内容和凭据脱敏 |
| 具体 `ProxySecretStore` | 只读凭据能力 `get(): Promise<ProxyCredentials \| undefined>`；纯凭据类型 | Runtime 不负责 store/delete。读取与应用继续在启动，凭据更新只标记待重启，不静默打断 |
| tree/Question artifact 路径 | 保留显式产物路径参数 | app 从自身产物定位；core 私有桥负责 token、临时文件与响应校验。不是 vscode 功能，不应禁用以绕过迁移 |
| 宿主专属 Pi 扩展启动信息 | 复用配置 `piArguments` 提供路径；按需提供启动环境值的窄入参 | 只在启动/重启读取，不新增扩展发现/注册框架；内部桥保留其专用环境键，自定义 CLI tokens 仍最后追加 |

日志接口和凭据类型必须是真正的无宿主类型；不能继续 `import type` 一个声明中包含 `vscode.SecretStorage` 的具体类。`Thenable` 若出现在迁移代码中也应改用普通 Promise 契约，并由插件适配，而非给共享包添加 vscode 类型依赖。

**不在首步抽象 Persistence。** [SessionPersistence](../../../../apps/vscode/src/extension/sessions/SessionPersistence.ts) 不在 Runtime 闭包，仍由 Registry 使用 `workspaceState`。后续共享集合时再决定 metadata store，而不是现在为 Desktop 先做文件数据库。

### 专属 Pi extension 的接入不受阻碍

[Registry 的 artifact 定位](../../../../apps/vscode/src/extension/sessions/SessionRegistry.ts) 与 [Question 桥](../../../../apps/vscode/src/extension/question-tool/QuestionToolExtensionBridge.ts) 已证明“宿主定位产物，Runtime 负责启动接线”的模式存在。未来 VS Code 状态采集、通信服务及其 Pi extension 保留在 `apps/vscode`；宿主传启动参数与必要环境信息，core 不读取编辑器状态，Desktop 不加载该扩展。

首步只保留这条启动数据路径，不实现状态工具、通信协议或通用扩展生命周期接口。后续实现仍需明确窗口状态与 Session 项目状态范围。全局安装的 Pi 扩展可能被两个宿主加载；不能用 RPC 模式判别 VS Code，也不能由共享包承诺解决此问题。

## 4. 包入口、构建与开发流程

建议包名为 `@frostime/pi-client`，名称是实现细节，以下入口形状才是约束：

```text
apps/vscode ──→ pi-client/core, pi-client/shared ──→ pi-rpc
未来 Desktop ─→ 同一份入口
浏览器构建 ───→ pi-client/ui, pi-client/shared, 显式样式入口

共享包不反向导入 app；两个 app 不互相导入。
不提供同时 export core + UI 的根 barrel。
```

首步只实际建立 `core`/`shared`。`ui`/样式入口的建立不要求同步搬全部 UI，也不提前建立空包目录。

### 推荐构建形态

- pnpm `workspace:*` 声明本地依赖，不需要发布 npm。Node core/纯 shared 由包自己的 TypeScript 构建产出 JS/d.ts；Svelte UI 在迁入时导出源码，由消费者现有 Vite/Svelte 编译，CSS/资产以显式入口消费。
- 开发条件可指向源码，默认导出指向 core/shared 构建产物；若现有工具链不能一致支持开发条件，可沿用仓库显式源码映射。但所有 TS/Vite/vitest/esbuild 映射必须一致且精确到子入口，不能出现 types 指向源码而执行陈旧 dist 的两套实现。
- 使用源映射或开发条件是实现选择，正式重构必须验证 TS 与 bundler 实际解析到同一来源。只在 tmp 用普通 package exports 链接成功，不代表正式 workspace 安装已通过。
- 新包声明自身真正的依赖，例如迁入的 core 使用 `minimatch`，shared 校验使用 `zod`；UI 迁入后声明 CodeMirror/Svelte/markdown 等依赖。不要依赖 app 恰好安装了它们。
- 分别用 core（Node）、shared（纯）、UI（浏览器/Svelte）检查配置约束环境。为了 ESLint projectService 可提供包根项目配置，但不能只给所有文件同时开放 Node+DOM 就称隔离完成。导入限制与产物图检查负责另一层约束。

临时 UI 包第一次构建在 `@codemirror/autocomplete` 解析处失败，原因是复制后的包没有自己的依赖解析路径。补齐临时包的依赖链接后构建通过。此结果说明**依赖归属必须随代码迁移**，不是需要拆包的证据。

### 现有接线必须修改的位置

| 位置 | 需要的修改 |
|---|---|
| [VS Code package.json](../../../../apps/vscode/package.json)、根 lockfile | 添加客户端 workspace 依赖；从仓库根安装，不能独立安装 app |
| [tsconfig](../../../../apps/vscode/tsconfig.json)、[Vite](../../../../apps/vscode/vite.config.ts)、[esbuild](../../../../apps/vscode/esbuild.config.mjs) | 明确子入口解析；保留 `$shared`/`$webview` 的迁移接线，不能在新包依赖 app 的 alias。Vite 普通字符串 alias 有前缀匹配，应避免把 `@.../core` 改写成 `index.ts/core` |
| [build](../../../../scripts/build.mjs)、[quality](../../../../scripts/quality.mjs) | 当前硬编码两个包，需加入客户端包及正确顺序；root 继续只编排，各包拥有本地脚本 |
| [ESLint](../../../../eslint.config.js) 与新包 tsconfig/test 配置 | 新包文件已能匹配全局 globs，但不自动拥有项目类型信息；增加导入边界规则、包级 lint/typecheck/test。现有 vitest 复用 app 的 vite.config，不应成为共享测试的宿主依赖 |
| [VSIX 校验](../../../../scripts/verify-vsix.mjs) 与打包 | VSIX 不携带 workspace/node_modules，新代码必须 inline 进插件产物。首步不改固定产物布局；UI 迁入时再验证相对资源与 Mermaid vendor 拷贝 |

插件日常流程仍是从根安装依赖，再运行插件及共享依赖的构建/检查，不需要 Electron：先 `pnpm --filter @frostime/pi-client build`，再 `pnpm --dir apps/vscode build`；局部测试仍可 `pnpm --dir apps/vscode exec vitest run ...`。可在插件本地 build 中编排必要共享依赖，使原插件 build 命令仍可用，但不能悄悄把 Desktop 纳入。新包有独立局部命令；根 check 在 Desktop 真正加入后可以检查多个产品，与插件开发是否必须运行 Desktop 是两回事。

## 5. 首步重构预测与迁移步骤

### 改动规模

首步是**少量职责改动 + 数十文件机械迁移/改导入**，不是“一两个 Wrapper 文件”，也不是全插件重写。静态 Runtime 闭包有 34 个本地文件；移除宿主依赖后，仍需迁移约 20–30 个 core 实现文件及必要 shared 类型。数字是预测，不是已批准清单或工期。

具体 core 集合以静态闭包和构建图交叉确认：`SessionRuntime`、`SessionEntryState`、`SessionViewState`、`OmpPromptCompatibility`、slash normalization、`ConversationProjection`/ItemStore/assistant adapter/message assembly/cache analysis、附件校验、`ExtensionUiCoordinator`/sanitize、`resolvePiModelScope`、Pi settings/canonicalPath、runtimeCompatibility/configured invocation、proxy configuration/environment、tree projection/bridge、Question bridge，以及独立脱敏模块。

必要 shared 来源是 [model](../../../../apps/vscode/src/shared/model/sessionViewModel.ts)、[输入协议](../../../../apps/vscode/src/shared/bridge/webviewToHost.ts)、[Question 协议](../../../../apps/vscode/src/shared/question-tool/questionToolProtocol.ts)。已有输入文件同时定义 Webview schema 与图像类型：可直接迁移该纯文件或提取单一图像输入类型，不能复制一个平行定义。纯 shared 紧密相连时，迁移整个纯 shared 子树也可接受；这会扩大机械改导入范围，实施前在变更清单中明确。

职责变动集中于 Runtime、Logger/凭据边界、插件 Runtime 创建接线；新增包配置和构建接线约 5–10 文件量级。移动关联 SPEC 与相关测试，并更新架构/开发文档归属，不重写现有契约。实际移动数量需在重构分支用 import graph 和 rename diff 确认。

### 分步迁移与验收点

| 步骤 | 可检查结果 | 停止条件 |
|---|---|---|
| A：原位置隔离 | Runtime 的版本/代理/日志/凭据依赖变为窄入参；Registry 继续同样创建、选择、恢复 Runtime；原测试通过 | 任何生命周期、URI 作用域或代理生效行为变化须单独解释，不借 refactor 静默改变 |
| B：无宿主运行证明 | 无 vscode mock 的 Runtime 行为测试在受控子进程上通过；实际运行和类型依赖都不需要 vscode | 单靠删除 import 或替换为空实现不算完成；仍有间接宿主依赖则留在 A 解决 |
| C：提取一个包 | core/shared 有明确导出，插件使用同一实现；共享测试独立运行；workspace/types/bundle 解析一致 | 不允许共享包反向导入 app、复制旧实现、长期靠跨 app 相对路径；迁移期兼容 re-export 仅用于逐步迁移并在本步收尾 |
| D：插件回归与打包 | narrow tests、包级检查、插件构建、受控 Extension Host 与 VSIX 产物检查；没有 Desktop 开发依赖 | 有环境阻塞则标明未完成验收，不以基线测试替代重构结果 |

A/B 可形成一个行为稳定的提交，C/D 再形成提取提交。独立提交便于定位问题：前者失败查宿主输入或时机，后者失败查导入/构建，而不是同时追踪两类问题。用户确认后才创建 `refactor/desktop-host-boundary`。

### 明确不动

- Registry 的目录选择/Git 授权、Provisional/ephemeral、Fork 提交恢复、tree 交互、启动与历史队列、持久化格式、通知规则。
- sidebar/panel ViewModel、连接授权、草稿交接、标签页管理及 Composer 行为；仅改 shared 导入位置，不改变 `BRIDGE_VERSION`。
- Pi RPC、文件写入策略、全局执行并发、Pi 自有对话/凭据存储。
- 不抽象所有原生选择框，不新建统一 HostRuntime 巨接口，不实现 Project、Electron IPC、窗口、托盘或新配置/对话数据库。

Registry **不是完全零改动**：`#createRuntime` 需要新输入和导入接线；“不拆 Registry”指其产品策略仍由插件拥有。

## 6. M1 之前仍需处理的 Bridge/UI 边界

Runtime 独立不等于 Electron 已能复用聊天。首步完成后，按下面最小范围安排连接/UI 准备；不要求先做完 Registry 最终重构。

1. [webviewTypes](../../../../apps/vscode/src/extension/webview-host/webviewTypes.ts) 将 `vscode.Webview` 换成真正的最小收发/可见性/dispose 端点。[WebviewConnection](../../../../apps/vscode/src/extension/webview-host/WebviewConnection.ts) 保留 ready、快照/增量、送达成功后的缓存推进及隐藏视图恢复；字体读取和 fd 警告由宿主提供。
2. [Dispatcher](../../../../apps/vscode/src/extension/webview-host/WebviewActionDispatcher.ts) 分开通用动作与编辑器/设置集成，但目标授权、版本/schema 校验、requestId 和错误返回仍在统一入口发生。可以让 Runtime 管理调用依赖其所需的接口，不提取包含整个 Registry 所有方法的巨接口。
3. [vscodeBridge](../../../../apps/vscode/src/webview/bridge/vscodeBridge.ts) 不只是名称：模块初始化直接调用 `acquireVsCodeApi`，没有宿主时使用空 postMessage。需要显式注入浏览器消息传输，**不能把现有空实现当 Desktop 适配成功**。
4. Composer 的 `/editor`、编辑器 specials、文件定位等改为宿主能力输入。UI 隐藏不支持入口，后端仍明确拒绝手工发送的动作。Pi/OMP 能力与宿主能力分开；标准阻塞 extension UI 不能随 IDE 功能一起关掉。
5. 保留插件对 sidebar/panel 的既有策略。单窗口验证可以先用既有 sidebar 表示方式，不必立即改协议；新增能力/字段或改变 required-field/delta 语义时依 [Bridge SPEC](../../../../apps/vscode/src/shared/bridge/webview-bridge.SPEC.md) 更新版本与双向校验。跨宿主聊天主体最终应消费具体能力/草稿策略，不能到处判断 `isDesktop`。
6. 共享 UI 不能把最外层 [App](../../../../apps/vscode/src/webview/App.svelte) 当成未经修改的通用根。它按展示列表裁剪批注；[Coordinator](../../../../apps/vscode/src/extension/webview-host/SessionWebviewCoordinator.ts) 也按 Registry 全量身份释放草稿。跨 Project 过滤不等于删除，需区分存活身份与可见列表。草稿、批注、异步请求与阻塞输入必须保持 Session 归属。

**本轮不决定一个 Project 一个 Registry，或应用级 Registry。** 前者可能复用更多集合规则，但要独立处理表面选择与 provisional 策略；后者需要更明确的集合接口。当前 Registry 的 `activateSession` 会丢弃未保留的 Provisional，启动前工作目录校验还依赖打开的 VS Code 工作区，不能原封不动用于 Desktop。也不能假定每 Project 独立 presentation 就自动保存浏览器草稿，销毁/重建 presentation 的保留规则需在 M2 明确。

主题需要 Desktop 提供变量与字体来源。现有 Codicon、Mermaid script、CSP、markdown 本地图片与资源 URL 都是实际边界，不止 import。M1 继续保留本机 Pi + 一次真实聊天的窄范围；完整多项目状态模型留给 M2。

## 7. 验证方案

### 首步必须完成

- **依赖检查**：core 禁止 vscode/Electron/app/UI；UI 禁止 Node/vscode/core；shared 禁止 Node/vscode/app/Svelte 运行时；检查 `import type`、re-export、动态 import 与构建 metafile，不能只用一条 rg 作为最终证明。
- **独立类型/测试**：共享包不安装 vscode 类型、不 `vi.mock("vscode")`；纯 shared 与 Node core 独立 typecheck。Runtime 测试保留受控 Pi stdio 路径，验证启动/停止、流式投影与持久化接管、历史加载时事件、retry settlement、队列/abort、Pi/OMP 兼容、Question 的请求取消。
- **宿主输入行为**：代理读取随启动/刷新而变化，credentials 仅启动应用；配置改变标记待重启、不打断运行；版本与 artifact 环境/参数正确；custom tokens 保持最后追加、重启复用且不日志/持久化。
- **插件回归**：现有 Runtime/Registry/代理/脱敏测试；工作区/远程 URI 与 linked worktree 配置、恢复、Fork、Provisional/ephemeral；对 pure migration 仍复跑 Bridge、草稿、Coordinator 相关测试以发现导入/类型变化。
- **构建/集成**：根安装后包级 lint/typecheck/test、插件 build、受控 Extension Host E2E；`pnpm package:vsix && pnpm verify:vsix`。验证产物无跨 workspace 运行时路径、无源码/node_modules 依赖，预算保持可接受。检查远程 Extension Host 中运行位置不变，不新增本地转发。

首步若不修改 UI 行为，不需把完整视觉重做纳入验收；UI 迁移后必须另验证 280px 与 light/dark/high-contrast、字体、输入法、附件及资源。

### M1 的真实验证，不在本轮执行

最小 Electron 窗口导入同一 core/shared/UI，不复制逻辑，不直连 raw Pi event。显式 IPC/消息端点维持 schema、目标会话授权与请求关联；renderer 不获得 Node 进程能力。使用本机已安装 Pi 验证发送、流式结果、停止、恢复现有历史，以及一个阻塞输入请求。

必须从 GUI 启动验证 Pi/外部 Node 定位，不能用终端启动替代；当前 [可执行文件定位](../../../../packages/pi-rpc/src/process/resolvePiExecutable.ts) 与 [configuredPiInvocation](../../../../apps/vscode/src/extension/configuration/configuredPiInvocation.ts) 会依赖 PATH/外部 Node。该风险不阻止首步薄接口重构，但 M1 必须提供真实证据。

### 本轮实验复核方法

临时文件未入 Git，以下保留决定性步骤与边界，避免把一次实验脚本升级为长期工具：

- **Runtime 实验**：读取基线 Runtime，仅去除 vscode/workspaceScope 导入；把同文件 Logger 依赖拆成纯脱敏函数和 error/info 类型；版本改值注入、两处代理读取改回调。通过 esbuild 的 onLoad 使用临时文本，其他实现不替换；onResolve 遇 `vscode` 即报错，RPC 解析真实 `packages/pi-rpc/src/index.ts`。先运行原入口作为失败对照，再构建转换入口并检查 metafile。实例化 Runtime，使用 `apps/vscode/test/e2e/fake-pi.cjs`，发送其 `stream-084` 场景，断言完成工具状态与 `sourceEntryId`，最后 stop/dispose。此实验没有检查类型声明闭包，也没有覆盖 Fork/Question 或真实 Pi。
- **包实验**：在 tmp 建 private ESM 包，core 入口指上一个实验产物，UI/shared 复制实际源码，不改行为；exports 提供独立 core/UI/shared/styles，消费者通过临时 node_modules junction 使用它。Node esbuild 导入 core；Vite + Svelte 按现有 `$shared`/`$webview` 映射编译实际 App，入口消费 shared bridge 版本、tokens.css 与 Codicon CSS。断言两侧图隔离、CSS 与字体相对 URL。core 使用的是预打包实验产物，不代表正式 TypeScript exports/typecheck 或 pnpm 安装完成。

本轮基线测试的命令（均使用隔离 Pi agent 目录）是：

```bash
pnpm --dir apps/vscode exec vitest run test/unit/SessionRuntime.test.ts test/unit/OmpSessionRuntime.test.ts test/unit/SessionRegistry.test.ts test/unit/diagnosticRedaction.test.ts test/unit/buildPiProcessEnvironment.test.ts
pnpm --dir apps/vscode exec vitest run test/unit/webviewBridgeSchema.test.ts test/unit/WebviewConnection.test.ts test/unit/WebviewActionDispatcher.test.ts test/unit/SessionWebviewCoordinator.test.ts test/unit/ComposerDraftCache.test.ts test/unit/composerDraftSync.test.ts
```

## 8. 待用户确认与实施者可决定的事项

**当前只需确认近期范围**：是否接受“先原位置解耦 Runtime，再提取一个客户端包的 core/shared；Registry 只接线、UI/Bridge 策略不改”的首步边界。建议接受。若希望首步就包括聊天/UI/Bridge 的通用化，也可选择，但那会涉及能力声明、协议和草稿策略，应单独列第二段改动说明，不再作为纯依赖清理。

包名、纯类型拆出文件的具体位置、源码开发条件与精确 alias 的选择、测试搬移与提交粒度，可由实施者在上述边界内决定，以实际构建/行为证据验收。

Project 集合模型、Desktop 草稿权威、平台与退出/恢复规则、首版集成能力表暂不阻塞 Runtime 重构，仍是 [Issues](../desktop-host.ISSUES.md) 的后续问题。它们不能在本报告中默认定案。

用户确认后，将调研结果整合回顶层规划，再建立重构分支。报告完成不代表重构获准，也不代表 M1 完成。
