---
status: draft
title: Desktop MSI 更新 — 代码变更形状
updated: 2026-11-03
---

# Desktop MSI 更新 — SHAPE

目标是 [TARGET-SPEC](desktop-msi-updates.TARGET-SPEC.md) 中的 MSI 安装与分阶段更新，不是实现通用下载器或自制文件替换器。用户已选择方案 B：Rust 持有下载文件和 MSI 执行权，Node 保留 Session 集合、准入与保存的权威；renderer 在现有 Settings Panel 内消费更新视图。这些变化集中在 Desktop，保留共享 ClientApp/Registry/Pi RPC 的现有职责。

本形状基于 `quasi-main` 的 `c29697a`（产品版本 `0.16.2`）。关键入口已检查；Session 入口映射由只读子任务辅助定位，并已回查 Registry、dispatcher 和导航源码。本次只创建文档，没有升级实验或实现；文件名、数量与行数均是待评审预测，不是已接受接口。

## 1. 路线取舍：持久缓存与 MSI 安装

```text
A. 直接使用 Tauri updater 的完整安装链
   updater.check → Update.download() → Update.install(bytes)
   + 复用官方检查、验签与安装器启动
   - download 返回内存 Vec<u8>，不是持久缓存
   - Update 持有私有 context，不能假设重启后可直接反序列化恢复
   - Windows install 最终 process::exit，不能自动复用 FrostPi 的异步收尾

B. Tauri 生成并签名 MSI，Desktop 自己持有窄范围更新协调（已选择）
   静态版本清单 → Rust 下载/验签/落盘 → Node 安装门禁与保存 → Windows Installer
   + 本地 MSI 及校验信息不依赖远端 latest 或内存 Update 对象
   + 安装时机和状态保存由 FrostPi 显式控制
   - 需要自己维护少量 HTTP/缓存/验签衔接代码与 Windows 启动参数
```

按当前“已下载包独立安装”和“保存完成后才退出”的要求，B 的整体适配更直接，但不保证代码量少于 A。用户据此选择 B：安装和文件升级仍交给原生 MSI，不自行覆盖程序目录；HTTP、SemVer 和 minisign 使用现成库，不实现密码算法，也不引入 Velopack 的另一套打包/启动体系。

路线选择已确认，不再把 A 当作可由实现 Agent 自行切回的候选。完整 SHAPE 仍是 draft：两版本 MSI、缓存、准入及失败恢复需要实验；若实验推翻 B 的前提，应报告证据并重新讨论，而不是更换路线或依赖远端 latest 来绕过本地包要求。

## 2. 空间 diff 树

以下范围不含自动生成的 lockfile 噪声。普通测试、文档调用方按组估算；会决定权威与控制流的文件单独列出。

```text
apps/desktop/
├── src/shared/
│   ├── desktopUpdates.ts             create  +55–85       additive；有限动作、投影视图，无路径/URL/密钥
│   ├── desktopBridge.ts              modify  +5–10        additive；DesktopApi 更新动作/订阅
│   └── desktopTransport.ts           modify  +1–3         local edit；登记有限更新通道
├── src/renderer/
│   ├── UpdateSection.svelte          create  +90–140      additive；Settings 内检查/下载/安装内容，不创建 dialog
│   ├── SettingsPanel.svelte          modify  +35–65       local edit；Updates 分区、动作与未保存设置保护
│   ├── DesktopApp.svelte             modify  +15–30       local edit；订阅更新视图并传给 SettingsPanel，不另开面板
│   └── tauriBridge.ts                modify  +5–12        additive；沿既有 desktop_request 转发
├── src/main/
│   ├── createDesktopBackend.ts       modify  +55–90       local edit；Session 准入门禁、安装资格、复用 dispose
│   ├── DesktopActionDispatcher.ts    modify  +12–25       local edit；New/Resume 全流程进入准入计数
│   ├── backend.ts                    modify  +25–45       additive；私有 prepare/cancelUpdate 协议、转发更新动作
│   └── desktopNative.ts              modify  +1–4         additive；有限更新操作能力，不开放任意安装路径
├── src-tauri/
│   ├── src/main.rs                   modify  +60–110/-20–35  moderate reorganization；将 drain 与最终 exit 分开
│   ├── src/native.rs                 modify  +5–12        local edit；Node 授权后的更新动作进入 Rust owner
│   ├── src/updates/
│   │   ├── mod.rs                    create  +180–260     owner；清单、下载、操作状态、调用生命周期边界
│   │   ├── cache.rs                  create  +120–180     owner；完成文件/校验元数据、本地恢复与安装前验签
│   │   └── msi.rs                    create  +70–110      owner；可信本地 MSI 交给 Windows Installer
│   ├── update-public-key.pub         create  grouped       仅发行公钥；私钥不进工作区
│   ├── tauri.conf.json               modify  +15–30       local edit；MSI、resources、签名产物与稳定升级标识
│   ├── Cargo.toml                    modify  +5–10        local edit；HTTP/版本/签名库及必要 Tokio 能力
│   └── Cargo.lock                    modify  grouped       依赖生成结果，不手写
├── scripts/
│   ├── package-msi.mjs               create  +80–130      owner；当前 JS/Rust/resources → MSI，正常打包必须重建
│   ├── prepare-msi-release.mjs       create  +60–100      owner；校验版本/来源，生成更新清单和发布资产
│   ├── packaging.mjs                modify  +10–20       local edit；复用版本与资源清单，不复制第二份资源列表
│   └── verify-msi*.mjs               create  grouped +140–240；安装/升级/取消验证，复用已有 GUI smoke
├── package.json                      modify  +2–5         additive；MSI 打包/验证入口，版本仍来自 VS Code manifest
├── test/                             modify/create grouped +100–180；准入、bridge、发布资产契约
└── src-tauri/src/updates/* tests      create grouped +180–280；缓存、签名、失败与安装协调

package.json                          modify  +2–4         additive；根级 MSI 编排入口
pnpm-lock.yaml                        modify  grouped       仅在 package 依赖实际变化时生成
.github/workflows/desktop.yml         modify  +25–45/-5–15  local edit；MSI/签名/清单按顺序发布
apps/desktop/SPEC.md                  modify  grouped       更新退出、缓存权威、Session 安装门禁
.dev/docs/{feature-map,release,testing,development}.md
                                      modify  grouped       入口、MSI 交付及真实升级证据边界
README.md / apps/vscode/README.md     modify  grouped       仅受影响的安装说明；不往插件文档灌入原生构建前提
CHANGELOG.md                         modify  grouped       实现完成后记录用户可见能力，不在本次文档任务中改版号
```

预计是千行级的中等改造，约一半复杂度在打包、原生收尾与验证，而非 UI。上面区间不构成硬预算；若需要改共享 Registry、重写传输、增加常驻服务或跨进程 Session 协调，属于形状变化，先停下讨论。

现有 ZIP 脚本和验证器不是默认删除对象；新增 MSI 入口不会把 `verifyArchive()` 冒充 MSI 验证。是否继续公开上传 ZIP 要先确认，不在这里预设双分发的永久维护承诺。

## 3. 调用与依赖转向

每棵树的箭头都表示运行时调用。未变化的桥接中间层压缩展示。

```text
[KEEP entry] SettingsPanel :: 现有 Settings 对话框
└──> [NEW] UpdateSection :: check / download / install
     └──> tauriBridge :: DesktopApi.updates
          └──> ... desktop_request / backend.ts / createDesktopBackend ...
               └──> desktopNative :: updateAction
                    └──> native.rs :: updates → updates/mod.rs :: handle
                         ├──> cache.rs :: 本地包与验签
                         └──> msi.rs :: Windows Installer

[NEW] updates/mod.rs :: 安装准备
└──> main.rs :: Backend.prepare_update（私有 Rust↔Node 请求）
     └──> backend.ts → createDesktopBackend :: prepareUpdate
          ├──> [KEEP] Registry.snapshot().sessions（所有 Project，而非选中项）
          └──> [NEW] Session 准入状态（含尚未建立 identity 的 New/Resume）

[NEW] updates/mod.rs :: 门禁通过后的安装
└──> main.rs :: Backend.drain（可等待的收尾结果）
     └──> [KEEP] backend.ts :: shutdown → createDesktopBackend :: dispose
          └──> [KEEP] Registry / navigation / stateStore 的 flush 顺序

[KEEP] 托盘 Exit / renderer failure
└──> main.rs :: Backend.close
     └──> [NEW extraction] Backend.drain → [KEEP] app.exit
```

正常 Exit 的“忙碌时确认”与更新的“任何 Session 都拒绝”是两个不同策略；共享收尾，不共享判断条件。`requiresExitConfirmation()` 不能成为更新资格的来源。

发布依赖单独表示：

```text
package-msi :: 当前源码 + 共用资源清单
└──> Tauri/WiX :: MSI + MSI.sig
     └──> prepare-msi-release :: 版本/来源/产物一致性
          └──> desktop.yml :: 先上传 MSI 与签名，最后上传更新清单
```

## 4. 决定性的边界草图

以下是候选接口，只说明职责；不是授权先向正式代码写类型。

```ts
// src/shared/desktopUpdates.ts：renderer 只能表达动作。
type DesktopUpdateAction =
  | { type: "read" }
  | { type: "check" }
  | { type: "download" }
  | { type: "install" };

interface DesktopUpdateView {
  currentVersion: string;
  available?: { version: string; notes?: string };
  downloaded?: { version: string };
  operation: "idle" | "checking" | "downloading" | "preparingInstall";
  progress?: { receivedBytes: number; totalBytes?: number };
  installBlock?:
    | { reason: "sessions"; count: number }
    | { reason: "opening" };
  error?: string;
}

// available 与 downloaded 分开：远端又发新版不能改变本地安装对象。
// 下载路径、源 URL、签名、密钥、msiexec 参数均不下发到 renderer。
interface DesktopUpdateApiAddition {
  updates(action: DesktopUpdateAction): Promise<DesktopUpdateView>;
  onUpdates(listener: (view: DesktopUpdateView) => void): () => void;
}
```

Node 的门禁内置在 `createDesktopBackend` 的应用生命周期所有者中，不新造通用 gate 框架。只向 `DesktopActionDispatcher` 注入一个包住 Session 创建/恢复流程的函数：

```ts
// 范围只覆盖 Desktop 会话准入，不给 Registry 增加 MSI 术语。
runSessionOpening<T>(work: () => Promise<T>): Promise<T>;
prepareUpdate():
  | { ok: true }
  | { ok: false; reason: "sessions"; count: number }
  | { ok: false; reason: "opening" };
cancelUpdatePreparation(): void; // 仅在尚未开始 shutdown 时可释放准入门禁
```

`runSessionOpening` 从进入 New/Resume 到它完成/取消全程计数。`prepareUpdate` 在同一事件循环片段内检查 Session 与计数并关闭准入，中间不能先 await。UI 资格投影只是提示，原子检查才授予安装资格；获准后新到的创建/恢复请求被拒绝。

Rust 的更新 owner 决定下载版本、缓存和操作状态，Node 只合并安装阻挡原因。UI 隐藏面板不取消已开始的下载，也不拥有缓存状态。安装是终止性操作：在关闭后端前发出“准备安装”的接受/状态反馈，不把正常更新退出显示成普通 IPC 故障；“已接受安装”不等于“MSI 已成功完成”。

## 5. 实现护栏

### Settings Panel 集成

- UI 入口已确定：沿现有 Settings 按钮打开，在面板内新增 Updates 分区。布局候选是现有分类导航中的 Updates 项，并在窄屏分类选择器中提供同一项；不新增顶部、侧栏按钮或独立更新 dialog，`DesktopShell.svelte` 不在预计 diff 内。
- `UpdateSection.svelte` 只承载更新内容和操作。`DesktopApp` 订阅宿主更新视图并传给 `SettingsPanel`，不增加单独的更新面板开关；关闭 Settings 不取消下载，重新打开读取宿主状态。
- 不把更新伪装成 schema setting：不新增更新状态配置键，不让 `settingsPages` 的普通字段计数、搜索或 Save 提交承担更新协议。分类渲染需区分普通配置页与 Updates 内容，保留原有设置搜索与草稿逻辑。
- 更新按钮使用独立动作，不触发表单 Save。切换分区保留设置草稿；若存在未保存修改，安装先经过现有保存/放弃确认语义，再提交安装请求，不静默丢弃或自动保存。不能为更新再造一套设置草稿存储。

### Session 与退出

- Registry 中 idle/stopped Session 也阻挡安装，`activeSessionId === null` 不说明集合为空。关闭最后一个 Session 不会自动新建；用户仍可通过既有 Settings 入口安装更新，不在 onboarding 另设更新入口。
- `DesktopProjectNavigation.#opening` 只按 Project 计数，`run()` 无选中 Project 时直接执行；不能直接复用它声称覆盖了所有未完成准入。候选计数放在 dispatcher 外层，覆盖这条分支，不在导航、Resume 视图和更新模块中各存一份权威。
- Fork/Retry/Activate 要求已有 identity，因此全部 Session 关闭后本来不可授权；不能为此改共享 SessionRegistry。实现时以现有授权测试核实这一前提。
- `Backend.close()` 当前会在等待 Node `closed` 后立即 `app.exit`。抽出 drain 时保留普通关闭的边界，但给更新返回真实保存结果：未收到 `closed(ok=true)` 不能启动 MSI。不能简单把普通退出的“报错后仍退出”照搬给更新。
- MSI 文件和签名应在关闭后端前完成最终校验，尽可能早地发现错误。收尾后若启动安装器失败，必须告知用户失败和重新打开原应用的方法；不能假装后端仍在线。是否提供自动恢复另行确认。
- 原生安装器由 Rust 启动，不从 Node 派生，不经 renderer 提供命令，不复用 Project action registry 来扩大工具执行权限。

### 缓存与信任

- 候选缓存位置为 `%LOCALAPPDATA%/FrostPi/updates/`，与 profile/settings/state 分离；这是提议，不是用户指定路径。
- 一个完成下载由 MSI 和对应版本/签名元数据组成。未完成文件使用独立临时名称，通过校验后才成为可安装记录；不引入持久下载队列、断点续传或多版本管理器。
- 下载后验签、安装前重新验签。使用现成 minisign 验证库及固定发行公钥；发布清单和缓存中的路径/签名都不是权威代码输入。只允许更新 owner 选定缓存中的 MSI。
- 缓存跨重启保留是当前候选；同一缓存被不同 profile 使用时的写入/安装冲突必须在实验中定边界，不能默认 profile 单实例锁会保护程序更新。
- 没有最新版检查结果不妨碍安装一个仍可信的本地包。签名私钥与 Windows Authenticode 证书是两件事；私钥不进 Git、日志、构建归档或客户端。
- 稳定 HTTPS 清单和 GitHub Releases 是当前候选分发源。请求失败明确显示，不变成“没有更新”；自动检查频率、代理适配和后台自动下载未定，不在这里静默增加策略。

### MSI 与交付

- MSI 打包必须使用同一产品版本、稳定 UpgradeCode 和匹配资源；不能以每次随机生成产品身份规避升级验证。具体安装范围、ProductCode/升级规则以 WiX 实验和用户选择为准。
- `bundle.resources` 纳入实际 backend 和 Pi 扩展；运行时资源目录应继续由 Tauri resolver 解析。不能假定旧 ZIP 的手工同级复制会自动进入 MSI。
- JS-only/VS Code 检查仍不需要 WiX、Rust 或签名私钥。普通 Desktop 无安装器构建与发行 MSI 构建分开，不能迫使每次本地启动都签名。
- hosted 发布仍遵循当前政策：本地做 Windows 验证，CI 负责构建/产物一致性/上传。不能借本次变更把 hosted GUI 测试重新设成发布门禁。
- 复用现有公开 Release 时保留资产不可变策略；更新清单在对应包完整发布后才出现。不能仅因插件 workflow 已创建同版本 Release 就通知 Desktop 更新。

## 6. 锁定前的实验与待确认项

| 项目 | 需要得到的结果 | 对形状的影响 |
|---|---|---|
| 两版本 MSI 最小实验 | 真正升级而非并排安装；backend/扩展匹配；安装目录、权限、取消与重启行为可观察 | 决定 WiX 配置、msi.rs 参数和是否需要有限安装器自定义 |
| 本地包实验 | 下载后断网、应用重新打开、远端版本变化时仍可按本地记录验签并安装；损坏时拒绝 | 确认 B 的缓存元数据与验签边界，不把实验作为自行切回 A 的授权 |
| Session 准入实验 | 暂停 New/Resume 的 discovery/picker；空集合不能越过该操作；获准后新请求被拒绝 | 确认门禁只需 Desktop dispatcher/backend，不必扩散到共享 Registry |
| 多 profile / 同一安装目录 | 另一个受支持实例仍打开时，MSI 不静默终止它及其 Pi 任务 | 尚未定案；建议拒绝并要求关闭其他实例，不承诺跨 profile 协调 |
| 保存/启动失败实验 | flush 失败不启动安装器；MSI 无法启动或用户取消有准确反馈和可执行恢复步骤 | 决定 drain 的返回形态；不默认增加自动回滚系统 |
| 用户确认 | 自动检查/下载策略、缓存保留、安装范围、升级后是否自动打开、ZIP 发布去留 | B 和 Settings Panel 内入口已确认；其余不能由 Agent 补全 |

验证脚本应复用 `scripts/smoke.mjs` 和 `cdp-client.mjs`，只增加 MSI 驱动，不建立另一套 GUI 自动化。必须隔离 MSI 产品标识、安装目录与 profile，避免在用户实例上测试升级、强杀或卸载。不能把系统安装器是否会强制关程序当作已经满足 Session 门禁的证据。

## 7. 实现时需要回查的资料

- 项目当前合同：`apps/desktop/SPEC.md`；打包、发布授权与证据边界：`.dev/docs/release.md`、`.dev/docs/testing.md`。
- 更新实现：<https://v2.tauri.app/plugin/updater/>；<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs>。2026-11-03 调研确认 `download()` 返回内存字节、`Update` 有私有 context、Windows `install_inner` 调用 `process::exit(0)`；选定具体 crate 版本时重新核对，勿当作永久 API 保证。
- MSI：<https://v2.tauri.app/distribute/windows-installer/>；WiX 模板 <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/msi/main.wxs>。安装范围和重启机制尚未在 FrostPi 实测。
- Session 入口：`DesktopActionDispatcher.ts`、`DesktopProjectNavigation.ts`、`DesktopResume.ts` 及 `createDesktopBackend.ts`，均在 `apps/desktop/src/main/`。共享 `apps/pi-client/src/host/SessionRegistry.ts` 提供集合与关闭语义，不是本次预计修改对象。

只有用户接受形状，且会改变核心路线的实验与责任问题有结论后，才将本文件改为 `status: locked`。本次文档任务不生成密钥、不构建安装器、不创建 tag、不推送或发布。
