# Desktop 副产品：阶段记录

## 基础阶段位置

产品代码截至 `feat/desktop-host@10819e0`（2026-10-24）。现有插件的通用实现已由 VS Code 与独立 Desktop 共用，Desktop 的多 Project、多 Pi、设置、正常关闭/重开和 Windows 独立包已落地。用户已认可主要使用与导航方向，当前收敛的是基础开发阶段，不是宣称所有体验和环境都已验收。

目标见同目录 `desktop-host.TARGET-SPEC.md`。本记录保留主要交付节点、影响后续维护的取舍与验证边界，不再承担逐步执行指令。下述检查是对应代码快照的历史证据，不表示每项在本轮文档整理中重新运行；本阶段未合并 main、改产品版本、签名或公开发布。

## 1. 隔离宿主依赖，先保住主插件

为在保住插件行为的前提下复用现有客户端，首步处理会话运行和应用行为中的 VS Code 依赖。先提取 Runtime、对话投影和纯契约，再解耦 UI/Bridge 的宿主输入；这是增加独立宿主的准备，不是另起一套客户端开发。

关键快照为 `eb05c72`。当时完整检查、VSIX 打包/校验和受控 Extension Host E2E 通过，用户反馈基础功能正常。这是插件重构的检查点，不能当作尚未创建的 Desktop 已完成。后续主目录代码在这个基础上继续演进，旧 worktree 不再是施工入口。

## 2. 同一客户端，VS Code 薄接线、Desktop 单向适配

用户再次明确主次关系后，架构从可能的“两端各适配一个中立平台”收敛为：以 VS Code 环境及术语为参考，共享 FrostPi 应用实现，Desktop 补齐它实际需要的宿主能力。共享主体放在 `apps/pi-client`，而不是包装成面向第三方的通用 SDK。通用 UI、Registry、Runtime 和消息桥只有一份；集中 `ClientHost` 声明能力，不模拟整个 VS Code SDK，也不随处导入产品运行时。

`7c3f671` 跑通两个产出；`e2cdae9` 将候选整合到主目录，`d0dbc29` 完成一批适配收尾。共享文案修改进入了两个实际 JS 产物，VSIX、受控插件 E2E 和 Electron 多 Project/多 Pi 路径取得通过。共享 Runtime 另用本机 Pi 1.1.0 验证过真实模型发送、Abort、历史恢复和阻塞输入；它与受控 Electron GUI 是两种证据，不合称完整真实 Pi GUI 验收。

适配收尾也验证了维护责任：Desktop 解释现有 QuickPick 图标/搜索语义，沿用共同字体解析、样式入口和资源路径，而不是改共享标签、手抄另一套字号或要求插件为 Desktop 重写界面。这些修正使“普通共享 UI 改动自然进入两端”不只停留在目录拆分上。

## 3. 补齐日常使用与双产出维护基础

| 交付 | 关键提交 | 结果及维护意义 |
|---|---|---|
| 设置定义单源 | `260a07a` | VS Code manifest 是权威来源，共享默认值由其生成；构建和一致性回归拦截过期值，避免两端默认值静默分叉 |
| 独立配置与首次导入 | `a9688cd` | 原始 dot keys 保存到独立 settings.json；只导入默认用户配置的白名单，预览不提前生效，Save 后独立维护；不持续同步 VS Code |
| 能力与产品接线 | `846c89e` | 静态能力声明、共享设置入口和产品本地命令归属明确；Desktop 隐藏或拒绝不支持的能力，插件原生集成不要求 Desktop 跟做 |
| 正常关闭与重开 | `cf3248e` | state.json 保存 Projects 和共享会话索引，正常关闭停止 Pi 并排空写入；只按保存选中项启动，不重放任务，不保存草稿或临时会话 |

设置定义、资源装配和行为测试共同承担兼容检查，不依赖开发者记住两份实现。新增的项目内 `.agents/skills/dual-maintenance/SKILL.md` 按改动类型路由代码归属、适配和聚焦验证；没有把插件局部工作变成每次都必须运行 Desktop，也没有用 bundle 字符串或表面能力存在性冒充行为保证。

## 4. 独立交付，并按实际使用反馈收尾

`dd40c9d` 补齐 Windows x64 免安装 ZIP 的打包与实际 exe 验证。Electron 随包，Node/Pi 是机器前置条件；profile 继续在系统应用数据目录，不是随 exe 携带数据。载荷白名单、运行许可、隔离启动、受控 Pi 和 GUI 式 PATH 验证进入交付流程，而非只证明开发服务器可用。该基线还完成过 VSIX 校验与受控插件 E2E；首次包的 `--real-pi` 是离线命令/确认卡验证，没有模型调用。

后续使用反馈推动导航从“Project 仅决定 New/Resume 目标、右侧仍看全局前台 Pi”改为按 Project 浏览。`1ae884b` 实现空 Project 的真实空状态、各 Project 上次查看项、会话归属、待输入聚合及可隐藏/调宽的侧栏。New/Resume 归属于发起 Project，包括其他 git worktree；恢复已打开文件仍复用原 Runtime，Fork 继承来源。共享客户端仍保留完整会话身份，Header 只收窄导航 roster，不靠裁剪快照实现分组；草稿与后台进程不因切 Project 丢失。

同一轮收尾包含代码字体、Token 紧凑单位和 Resume 等待反馈（`9db7943`、`7dfa671`），以及顶部 Project 信息对齐（`10819e0`）。它们是独立交付后的使用修正，不改变共享客户端与 Desktop 适配的主线。导航复杂度留在 Desktop，共享层只补清空前台、打开身份通知和可选 Header roster，VS Code 默认行为由回归保护。

### 当前候选与验证范围

| 项目 | 记录 |
|---|---|
| 源码快照 | `10819e0`；其中 `aa6b311` 修复本机 Compress-Archive 产生反斜杠 ZIP 条目名的问题，规范后再校验和发布 |
| 归档 | `artifacts/FrostPi-0.15.5-win32-x64.zip`，161,481,099 B，145 个文件 |
| SHA-256 | `ac343b08e9d758e17e15b4353ed4684cc115597a70e0763e12f0fcc296472b64` |
| 启动 | 解压运行 `FrostPi/FrostPi.exe`；旧展开目录不会自动更新，试用应关闭旧版并解压到新目录 |

| 验证对象 | 已取得的证据 | 范围限制 |
|---|---|---|
| `1ae884b` Project 导航批次 | 最近一次完整 `pnpm check`：137 文件 / 935 测试，类型、lint、双端构建及插件预算通过；增强 Electron smoke 覆盖 worktree 归属、空 Project、CodeMirror 草稿、后台输入、调宽/隐藏、280px 抽屉和重开 | 是该快照的全仓检查，不是后续所有提交的检查 |
| `10819e0` 顶部排版调整 | Desktop 类型、修改文件 lint、构建和实际 Electron smoke 通过，含宽/窄窗对齐、菜单边界和同一草稿恢复 | 未重跑全仓 check、插件 GUI E2E 或真实模型 GUI |
| 上表的具体 ZIP | 标准打包/验证通过；仓库外带空格路径中的实际 exe 通过 16 项受控检查，69 个 runtime 文件与构建逐字节一致，归档分隔符正确 | 证明受控子进程与分发路径，不证明真实模型 GUI；也不标识任意后来 checkout |

较早的共享 Runtime 真实模型验证和首次包的离线真实 Pi 探针，不替代最新候选的 GUI 验证。其他平台、所有用户扩展组合、完整远程/主题体验也未由这些检查证明。

详细旧记录可从本次整理前的 Git 快照 `10819e0` 查阅；临时日志与截图不作为继续维护的前置依赖。

## 后续讨论与维护整理

- **设置页呈现**：用户要求改进 checkbox 独占一行、信息松散等问题，具体方案未定。后续设计须保留原始键、显式 Save/Reset 和导入预览规则，不借布局调整重写配置行为。入口是 `apps/desktop/src/renderer/SettingsPanel.svelte`。
- **独立 UI 字体设置**：目前没有对应入口。是否新增、键名和应用内控制范围仍需讨论；正文/Composer 的字体设置不是 UI 字体设置，也不能承诺改变 Windows 原生菜单或文件选择器。
- **主题**：`apps/desktop/src/renderer/theme.css` 当前提供固定暗色调色板，不读取 VS Code 当前主题或跟随系统。明暗/系统切换及主题导入尚无获批实现方案，不自动扩成完整主题引擎。
- **长期文档**：下一步校准 AGENTS 与 `.dev/docs` 的主次关系、路由和当前事实。尤其 `.dev/docs/architecture/overview.md` 仍保留“Project 只是新建/恢复 anchor”的旧描述；本轮只整理 change，尚未修正文档之外的入口。当前 Project 合同以 `apps/desktop/SPEC.md` 为准。

## 当前维护入口

| 要处理的问题 | 先读哪里，以及它提供什么 |
|---|---|
| 判断改插件、共享客户端还是 Desktop | `.agents/skills/dual-maintenance/SKILL.md`：源码归属、适配责任和首轮检查；具体功能位置见 `.dev/docs/feature-map.md` |
| 改共享客户端或宿主能力 | `apps/pi-client/SPEC.md`：环境、生命周期、可选宿主接缝与完整 presentation 的约束 |
| 改 Project、设置、状态文件或桌面交互 | `apps/desktop/SPEC.md`：Desktop 行为及原生权限合同，不必先读旧交接 |
| 开发、验证与候选交付 | `.dev/docs/development.md`、`.dev/docs/testing.md`、`.dev/docs/release.md`：包脚本、证据边界和打包/版本流程 |

需要核实目标来源时，可用 read-pi-session-history 定点读下列原话；日常维护不以补读 session 为前提。

| 主题 | Session ID | Entry |
|---|---|---|
| 插件只需遵守边界，Desktop 自担适配；切 Project 不干预后台 | `01a12ae2-065f-77ce-8ae0-9b463d3b9410` | `c03bb6e7` |
| 主插件/副产品关系，以及 TARGET-SPEC 的三个重点 | `01a15060-927e-7724-9dee-5df399fd9ad7` | `a0ff3a43`、`37f3a934` |
| 应用归属、VS Code 参考环境与集中宿主 interface | `01a1545d-6e83-77f7-a210-41067102430d` | `854f51bd`、`be0d283c` |
