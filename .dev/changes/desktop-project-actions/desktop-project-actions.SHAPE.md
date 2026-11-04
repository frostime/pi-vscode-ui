---
status: locked
---

# Desktop Project 排序与 Action 菜单 — SHAPE

这是 Desktop 外壳的一次**局部增补**：顺序能力落在已有的 `DesktopProjects` 上（本来就用 `Map` 保存、本来就整表持久化），菜单能力新增一条"动作集合由 Node 定义、进程启动由 Rust 壳执行"的窄通道。改动集中在一个渲染组件、一个新建的主进程动作注册表和一段 Rust 原生分支；没有跨产品边界，也没有触碰 Pi 运行时、会话归属或 `state.json` 结构。

## 1. 视觉形状

### A. 空间 diff 树

```text
apps/desktop/
├── src/shared/
│   ├── desktopBridge.ts          modify  +12           动作视图投影（id/label/icon）+ 两个 API 方法
│   └── desktopTransport.ts       modify  +2/-2         有限通道清单登记两条新通道（易漏点）
├── src/renderer/
│   ├── ProjectActionMenu.svelte  create  +80–100       渲染下发的动作项、fixed 定位测量、键盘导航/关闭
│   ├── DesktopShell.svelte       modify  +70–95/-30    行尾 ⋯ 入口、拖拽重排、顶栏按钮+悬停提示；中等本地改写
│   └── tauriBridge.ts            modify  +4            两条通道转发
├── src/main/
│   ├── desktopProjects.ts        modify  +18–25        moveProject：按索引重排 Map 顺序后 emitChange
│   ├── projectActions.ts         create  +120–150      动作注册表 + 4 条动作定义 + PATH/PATHEXT 探测
│   ├── createDesktopBackend.ts   modify  +25–35        启动 initialize 一次、视图注入动作投影、两条通道监听与校验
│   ├── desktopNative.ts          modify  +1            launch(executable, args)
│   └── backend.ts                modify  +1            把 launch 接到私有壳协议
├── src-tauri/
│   ├── Cargo.toml                modify  +1/-1         windows-sys 增加 Win32_UI_Shell；移除 open 依赖
│   └── src/native.rs             modify  +50–70/-6     launch 操作 + 替换两处 open::that_detached 为自有 ShellExecuteExW
├── test/
│   ├── desktopProjects.test.ts   modify  +30–40        moveProject 正常/越界/未知 id/不改选中项
│   ├── projectActions.test.ts    create  +80–100       探测、可见性过滤、参数决策、未知/未启用动作被拒绝
│   └── desktopBackend.test.ts    modify  +30–45        通道级：重排回显与动作派发；fixture 补 launch
└── SPEC.md                       modify  +12           顺序所有权与"进程启动归原生壳"两条持久约束

.dev/docs/feature-map.md          modify  +1/-1        Project 行补上新模块名
```

预估净增 ~400 行，其中约 45% 是注册表与菜单，其余是就地改写与测试。除 `DesktopShell.svelte` 的拖拽片段外，没有大段重写。

### B. 调用与依赖转向树

```text
DesktopShell.svelte :: Project 行 ⋯ / 顶栏按钮
└──> tauriBridge.ts :: projectAction            [NEW: frostpi:projects:action]
     └──> ... (私有 Node↔Rust 传输不变) ... ──> createDesktopBackend.ts :: listen(action)
          └──> ProjectActions :: run            [NEW]  校验动作已启用，解析项目根目录
               └──> 条目 :: invoke              [NEW]  由条目自行决定命令（或走 openPath）
                    └──> DesktopNative :: launch [NEW]
                         └──> ... (壳私有 wire 不变) ... ──> native.rs :: launch [NEW]
                              └──> ShellExecuteExW   出 Job，进程随应用退出仍存活

DesktopNative :: openPath / openExternal        [KEEP 接口，换实现]
└──> native.rs :: shell_open  [NEW]             ShellExecuteExW + verb 空（默认动作）
     ├── 替换 [REMOVED] open::that_detached(path)
     └── 替换 [REMOVED] open::that_detached(url)

DesktopShell.svelte :: 拖拽重排
└──> tauriBridge.ts :: moveProject               [NEW: frostpi:projects:move]
     └──> createDesktopBackend.ts :: listen(move)
          └──> DesktopProjects :: moveProject    [NEW]
               └──> [KEEP] onDidChange ──> publishProjects + stateStore.saveProjects
```

### C. 关键边界草图

```ts
// apps/desktop/src/main/projectActions.ts —— 动作集合的唯一所有者
export interface ProjectActionEnvironment {          // 探测环境，可注入以便测试
  PATH?: string;
  PATHEXT?: string;
  isFile(path: string): Promise<boolean>;
}

export interface ProjectActionContext {              // 执行期能力，由桌面壳提供
  readonly root: string;                             // 主进程解析的项目根目录（从不来自渲染层）
  launch(executable: string, args: readonly string[]): Promise<void>;
  openPath(path: string): Promise<void>;
}

export interface ProjectAction {
  readonly id: string;                               // "reveal" | "vscode" | "zed" | "terminal"
  readonly label: string;                            // 菜单文案，唯一定义处
  readonly icon: string;                             // codicon 名
  detect?(environment: ProjectActionEnvironment): Promise<boolean>;  // 缺省 = 始终可用
  invoke(context: ProjectActionContext): Promise<void>;
}

export class ProjectActions {
  async initialize(environment?: ProjectActionEnvironment): Promise<void>;  // 每条 detect 跑一次
  get view(): ReadonlyArray<{ id: string; label: string; icon: string }>;    // 顺序即菜单顺序
  async run(id: unknown, root: string): Promise<void>;                       // 未启用/未知 → 拒绝
}
```

要点：**协议不承载可执行文件**。`launch(executable, args)` 只是上下文提供的执行能力，命令形态、平台分支、是否先做路径解析，全部由条目自己决定（例如打开目录既可以用现有的 `openPath`，也可以在条目里改成 `launch("cmd.exe", ["/c", "start", "", root])`）。

```ts
// apps/desktop/src/shared/desktopBridge.ts
export interface DesktopProjectActionView { id: string; label: string; icon: string }  // [New]

export interface DesktopProjectsView {
  // ...
  actions?: DesktopProjectActionView[];   // [New] 已启用动作；瞬态，不落盘
}

export interface DesktopApi {
  // ...
  moveProject(id: string, index: number): void;               // [New] index = 移除后的目标下标
  projectAction(id: string, action: string): void;            // [New] action 只能是视图里出现过的 id
}
```

```ts
// apps/desktop/src/main/desktopNative.ts
launch(executable: string, args: readonly string[]): Promise<void>;  // [New] 通用执行能力
```

```text
# native.rs 的 launch 分支（结构级）
"launch" => { 校验 executable 为绝对路径且是文件；参数数量/长度有界；
              ShellExecuteExW(lpFile = executable, lpParameters = 转义后的参数串)；
              返回值 <= 32 视为失败 → Err }

# native.rs :: shell_open（替换 open::that_detached，结构级）
fn shell_open(target: &str) -> Result<(), &'static str> {
    ShellExecuteExW { lpVerb = null, lpClass = null, lpFile = target, nShow = SW_SHOWNORMAL }
    // 返回值 <= 32 视为失败；目录与文件同一条路，不得按目录改走 explore / SHOpenFolderAndSelectItems
}
```

## 2. 实现护栏与红线

- **`projectActions.ts` 是唯一定义"有哪些动作"的地方。** 菜单顺序、文案、图标、可用性都从它派生；渲染层不持有第二份动作表，主进程也不写按 id 分支的 switch。
- **协议里没有可执行文件、没有 `type` 判别字段。** 条目自己决定命令与平台分支；等第二种调用形态真正出现再加判别字段，成本为零。
- **`DesktopShell.svelte` 不得探测工具或拼命令。** 菜单项完全来自 `view.actions`；拿不到就只显示移除项。
- **渲染层只给 `(projectId, actionId)`，从不给路径。** 根目录由主进程从 `DesktopProjects` 查得；这是"授权"与"能力"分离的唯一实现点。
- **禁止 `node:child_process` 启动外部程序。** Node 处于 `KILL_ON_JOB_CLOSE` Job 内（实测孙进程随 Job 关闭被杀）；用了它用户关掉 FrostPi 就会连编辑器/终端一起消失。这条是行为正确性，不是风格。
- **“打开所在文件夹”必须走默认动作，不得显式传 `open`。** 实测（临时 HKCU 文件类）：`ShellExecuteExW(verb="open")` 命中 `open` 动作，`verb=<default>` 命中类默认动作，`Invoke-Item`（crate 当前路径）命中默认动作。本机 Dopus 把自定义动作 `openindopus` 设为 `Directory` 类的默认动作，而 `open` 动作仍指向 `C:\Windows\Explorer.exe`——所以显式传 `open` 会在用户的替换式文件管理器上退回 Explorer（Electron 的 `openPath` 就是这个行为）。当前 `openPath` 走 `Invoke-Item` → 默认动作，兼容性正确，不要为了“统一走 launch”改成显式 `open`。
- **`moveProject` 只移动 Map 表达的顺序，然后走既有 `#emitChange()`。** 不得在 `DesktopProjectNavigation` 里再存一份顺序；拖拽反馈是纯 UI 状态，松手后接受主进程回显。
- **索引语义写在一处**：`index` 是"移除被移动项之后的目标下标"，主进程校验整数且落在 `[0, length)`，越界抛错而不是夹取；同位置移动不发变更。
- **顺序不进入 `state.json` 的新字段**：现有 `saveProjects` 按 `view.projects` 数组顺序写 `id/name/cwd`，`restore` 按数组顺序建表；不要顺手升级状态版本。
- **两个新通道必须同时登记到 `desktopRequestChannels`**，否则 `isDesktopRequest` 直接拒绝，现象是"点了没反应"。
- **探测只在启动时做一次**，结果只进瞬态视图字段；`DesktopStateStore.saveProjects` 只保留 `id/name/cwd`，探测结果不得落盘。
- **顶栏不再常驻渲染路径**；`Pi <cwd>` 差异只通过悬停提示表达，不加常驻徽标。
- **菜单定位复用测量 + `position: fixed`**：`⋯` 位于 `.project-list`（滚动容器）内，CSS popover 会被裁剪；菜单挂壳层，靠窗口底部时向上翻转。
- **`openPath` / `openExternal` 的打开一律走默认动作。** `shell_open` 的 `lpVerb` 与 `lpClass` 必须为空；禁止 `explore` 动作、禁止 `SHOpenFolderAndSelectItems`、禁止经 `cmd.exe` 解析路径。依据：本机 `Folder\shell` 默认值为 `openindopus`（Dopus），而 `Folder\shell\open\command` 与 `explore` 都指向 Explorer；`%`/`&` 会破坏 cmd 解析（均已实测）。
- **`openExternal` 的 scheme 白名单与错误文案保持原样**，只替换执行方式；URL 不得进入任何 shell 解析。
- **超长路径（> 260 字符）未验证**：新旧实现都没测过；记为已知限制，除非真机出现。
- **测试区分"探测"与"启动"**：注册表用例断言可用性与命令决策，通道用例断言路由与拒绝；真实进程启动只在用户手工检查里验证。

## 3. 待用户确认

- diff 分布：新增一个渲染组件（菜单）+ 一个新主进程动作注册表 + 一段 Rust 原生分支，而不是把菜单塞进 595 行的 `DesktopShell.svelte`、把动作表塞进 `createDesktopBackend.ts`。
- 打开目录走现有 `openPath`（默认动作，已验证在本机 Dopus 默认动作下生效），而不是在条目里用 `cmd.exe /c start`：`start` 同样是默认动作语义，没有额外兼容收益，反而多一层 cmd 引号/`&` 转义风险。
- **可选**：是否顺带在 `apps/desktop/src-tauri/Cargo.toml` 打开 `open` 的 `shellexecute-on-windows` feature。收益是去掉 `powershell.exe` 跳板（受限策略环境下更稳）并取消“快速失败则退回 `explorer.exe`”的兜底分叉；风险是该 feature 改变的是**全应用**的 `openPath` 行为（设置页打开 settings.json、文件链接都受影响），需要同等的真实环境验证。它是 1 行改动，可以并入本轮，也可以单列 follow-up。
- `label` / `icon` 随视图下发（加一项只改注册表，当前选择）vs 渲染层持有文案表（分层更纯，但重新引入 id 集合两处同步）。
