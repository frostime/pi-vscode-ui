---
title: Desktop Project 排序与 Action 菜单 — 评审记录
description: 两次独立评审（正确性 / 可维护性）的结论、逐条核实结果、处置与端到端证据。
scope:
  - /apps/desktop/**
updated: 2026-11-03
status: completed
---

# 评审记录

对 `quasi-main..feat/desktop-project-actions`（提交 `d649fb2`）做了两次只读独立评审：一次正确性/行为、一次可维护性/架构。以下每条都先独立复核，再决定处置；评审建议本身不作为结论。

## 正确性评审

| 评审意见 | 复核结果 | 处置 |
|---|---|---|
| `code.cmd` 参数经 cmd 解析，未加引号的 `&` 会切断路径 | **成立**。Spike：`-n C:\work\A&B` 到达时被切成 `C:\work\A`；加引号后完整。`%NAME%` 即使加引号也会展开 | `native.rs::quote_argument` 改为**始终加引号**；`%NAME%` 不可表示的限制写在代码注释里 |
| 建议"改用原生 `Code.exe` 绕开 cmd" | **不成立**。实测 `code.cmd -n <dir>` 新开窗口，`Code.exe -n <dir>` 不新开窗口——CLI 语义只在 shim 里 | 不采纳，继续用 `code.cmd` |
| 键盘在行菜单与顶栏之间切换时菜单不重新定位 | **成立**。未加 key 的 `{#if}` 复用同一实例，`onMount` 不再执行 | `DesktopShell.svelte` 用 `{#key menu.anchor}` 强制重挂 |
| 列表滚动后 fixed 菜单脱离原行 | **成立** | `ProjectActionMenu.svelte` 增加 document `scroll`（capture）关闭，忽略菜单自身滚动 |
| 原生启动失败无法给出有用原因 | **成立，但为既有传输限制**：Rust 的 `nativeResult` 不带错误文本，Node 一律抛通用错误 | 本次范围内只做"指明是哪个工具"：`projectActions.ts` 为每个工具保留 `tool` 名，失败抛 `Could not start <tool>.`；传输层改进不在本次范围 |
| `is_launch_target` 的裸文件名分支无消费者 | **接受**（可维护性评审同一观察） | 收敛为只接受绝对路径；注册表用 `resolve()` 产出绝对路径 |

## 可维护性评审

无结构性发现。评审确认：动作集合/顺序/文案/可用性只有 `projectActions.ts` 一个所有者；`ProjectActionMenu.svelte` 与 `projectActions.ts` 是真实边界而非转发层；渲染层只保留表现态并等待宿主回显；错误仍走既有 listener→toast 通道。

评审指出的唯一事实偏差：实际 diff 大于锁定 SHAPE 的估算（`DesktopShell.svelte` +200/-26 对 +70–95/-30，`native.rs` +117/-2 对 +50–70/-6）。核实后属估算偏低（拖拽交互、提示层样式、菜单生命周期、参数引号与校验），落点仍全部在预测的 owner 内，无平行状态或新框架。

## 端到端证据（构建后真机，临时 profile + CDP）

- 视图下发 `reveal, vscode, zed, terminal`，顺序与文案正确。
- 未知动作 → toast `Unknown Project action: nope`（证明错误通道可用，因此"无 toast"有意义）。
- `vscode`：项目目录命名为 `first & project`，调用后新开 1 个 Code 窗口，标题包含 `first & project` —— 引号修复在真实链路上生效。
- `reveal`：新开 1 个 Dopus 窗口，无 toast —— 默认动作语义正确。
- `terminal`：新开 1 个 Windows Terminal 窗口，无 toast。
- `moveProject`：视图顺序变化，`state.json` 的 `projects` 顺序同步。

## 剩余已知限制

1. 项目路径含 `%NAME%` 成对写法时，VS Code 动作（经 `code.cmd`）无法原样传递。单侧 `%` 正常。
2. 原生操作失败的具体 Windows 错误码不会到达 UI；toast 只说明失败的动作。这是既有私有 wire 的能力边界。
3. 超过 260 字符的路径未验证（新旧实现都未测）。
