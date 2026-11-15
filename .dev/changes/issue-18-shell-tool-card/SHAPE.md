---
status: locked
---

# Issue #18 — PowerShell 卡片按 shell 工具呈现

Issue: [#18](https://github.com/frostime/pi-vscode-ui/issues/18) · milestone v0.16.7

## A. 空间 diff 树

```text
apps/pi-client/src/
├── shared/model/
│   └── shellTools.ts                  create  +10–14    additive
│                                      唯一持有"哪些 Pi 工具是 shell 命令工具"
├── core/conversation/
│   └── messageAssembler.ts            modify  +2/-1     local edit
│                                      toolLabel(): isShellTool() 取代 name === "bash"
└── ui/features/conversation/
    └── ToolActivity.svelte            modify  +2/-1     local edit
                                       toolIcon(): isShellTool() 取代 name === "bash"

apps/pi-client/test/unit/
└── ConversationProjection.test.ts     modify  +24       additive
                                       锁定"powershell 的卡片 label = 命令文本"

apps/vscode/test/unit/
└── ToolActivity.test.ts               modify  +18       additive
                                       锁定"powershell 卡片带 codicon-terminal"

CHANGELOG.md                           modify  +1       additive
```

## B. 调用与依赖变化

```text
core/conversation/ConversationProjection.ts :: applyToolCall()
└── ... (状态/时长拼装 pass-through) ...
    └── core/conversation/messageAssembler.ts :: createToolView()
        ├── toolLabel()
        │   ├── [NEW]  shared/model/shellTools.ts :: isShellTool()
        │   └── [KEEP] toolFilePath()、grep 的 pattern 回退
        └── [KEEP] 其余 bound 视图字段

ui/features/conversation/ToolActivity.svelte :: toolIcon()
    ├── [NEW]  shared/model/shellTools.ts :: isShellTool()
    ├── [KEEP] toolElapsedTimers.ts :: isElapsedTimerTool()   # 另一条契约，未动
    └── [KEEP] 头部 name/label、Input/Output 分节、错误摘要、耗时
```

## C. 新边界签名

```ts
// apps/pi-client/src/shared/model/shellTools.ts
const SHELL_TOOL_NAMES = ["bash", "powershell"];

/** Case-insensitive, matching the tool name Pi reports. */
export function isShellTool(name: string): boolean;
```

## 实现红线

- `SHELL_TOOL_NAMES` 不得与 `ELAPSED_TIMER_TOOLS` 合并：`codemode` 在后者的列表中但不是 shell 工具。
- 不在 `BoundToolCallView` 上新增分类字段。分类必须可按名字推导，使实时视图与已存会话重建视图一致。
- 不改执行与结果语义：`args`、`output`、`status`、`isError`、`durationMs` 和分节规划都不动。
- `shared/` 侧保持纯函数、无 Node/host 依赖。
- 若需要改 `toolSectionPlan.ts`、`conversationModel.ts` 或 `ConversationProjection.ts`，先停下来说明形状漂移。

## 验证

1. `pnpm --dir apps/pi-client exec vitest run test/unit/ConversationProjection.test.ts`
2. `pnpm --dir apps/vscode exec vitest run test/unit/ToolActivity.test.ts`
3. 收尾 `pnpm check`

两条新测试在修复前各自失败、修复后通过，已实测。

## 完成判定

- `powershell` 卡片的折叠头部：terminal 图标 + 实际命令文本。
- 展开后的 Input / Output / 状态 / 错误摘要 / 耗时与改动前一致。
- `pnpm check` 通过，CHANGELOG 有 `[Unreleased] → Fixed` 记录。
