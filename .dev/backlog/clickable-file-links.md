---
created: 2026-07-21
status: planned
---

# 支持点击消息中的文件路径链接

## 目标

在 FrostPi conversation 中，Markdown 文件链接和完整的内联代码文件引用可点击，直接在 VS Code 编辑器中打开对应文件。支持 `<path>:<line>`、`<path>:<line>:<col>`、`<path>:<start>-<end>` 和 GitHub 风格的 `<path>#L<start>-L<end>`；纯文本文件名不自动渲染为链接。

## 现有基础设施

Host ↔ Webview bridge 的 `openFile` 消息位于 `apps/vscode/src/shared/bridge/webviewToHost.ts`，携带 `path` 以及可选的 `line`、`column` 和 `endLine`。`column` 和 `endLine` 均依赖 `line`，范围必须正序，且范围与列号互斥。

Host 侧处理链路为：`webviewToHost.ts` 定义 → `WebviewBridge.ts` dispatch → `openReferencedLocation.ts` → VS Code `vscode.window.showTextDocument`。

## 缺口：Webview 侧不识别文件路径

`MarkdownHtml.svelte` 的 `handleClick` 当前逻辑（`apps/vscode/src/webview/features/conversation/markdown/MarkdownHtml.svelte`）：

```typescript
function handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    const href = target?.getAttribute("href");
    if (!href || (!href.startsWith("https://") && !href.startsWith("http://"))) return;
    event.preventDefault();
    postToHost({ type: "openExternal", url: href });
}
```

两处缺失：
1. 不处理非 http(s) 的 `<a href>` ——文件路径链接直接 fallthrough 到浏览器默认行为（webview 内无效）
2. 不处理内联代码中的文件路径（例如 AI 可能用 `` `path/file.ts:42` `` 引用，markdown-it `linkify` 不会将其转为 `<a>` 标签）

## 输出文件路径的常见格式

| 格式 | 示例 | Markdown 渲染结果 | 是否可点击 |
|------|------|--------------------|-----------|
| Markdown link | `[src/foo.ts](src/foo.ts)` | `<a href="src/foo.ts">` | ❌ 非 http(s) 被丢弃 |
| 内联代码 + 行号 | `` `src/foo.ts:42` `` | `<code>src/foo.ts:42</code>` | ❌ 不在 `<a>` 内 |
| 裸文本 | `src/foo.ts` | 纯文本 | 保持纯文本（预期） |
| 绝对路径 | `` `/home/user/project/src/foo.ts` `` | `<code>` 或纯文本 | ❌ |

## 推荐实现

### 1. `<a>` 标签拦截：处理非 http(s) 链接

扩展 `handleClick`，对非 http(s) 的 `href` 做文件路径识别：

```typescript
function handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    const href = target?.getAttribute("href");
    if (!href) return;
    event.preventDefault();

    if (href.startsWith("https://") || href.startsWith("http://")) {
        postToHost({ type: "openExternal", url: href });
        return;
    }

    // 尝试解析为文件路径 + 可选行号
    const parsed = parseFileLink(href);
    if (parsed) {
        postToHost({ type: "openFile", path: parsed.path, line: parsed.line });
    }
}
```

### 2. `<code>` 块扫描：识别 `path:line` 模式

对内联代码块中的文本做正则匹配，将匹配到的文件引用包装为可点击的 `<a>`：

```typescript
// 在 renderMarkdownHtml 之后，对 <code> 内容做 post-processing
// 或在 markdown-it 插件中做 inline code 渲染劫持

const FILE_LINK_RE = /^([^\s`"']+\.[a-zA-Z0-9]+)(?::(\d+))?(?::(\d+))?$/;
```

策略选项：
- **A：post-render DOM 扫描**——在 `@html` 绑定后通过 MutationObserver 或 `$effect` 扫描 `<code>` 元素，匹配后替换为 `<a>`。简单但可能触发 reflow
- **B：markdown-it 插件**——在 markdown-it 的 `code_inline` 渲染规则中做劫持。更干净，在 HTML 生成阶段完成

推荐 **B**：在 `renderMarkdown.ts` 中注册自定义 `code_inline` 渲染器，对匹配的文件引用输出 `<a>` 而非 `<code>`。不需要改动 `MarkdownHtml.svelte` 之外的组件。

### 3. 路径解析规则

| 输入 | 行为 | 示例 |
|------|------|------|
| 绝对路径（匹配 workspace） | 直接打开 | `/home/user/project/src/foo.ts:42` |
| 绝对路径（不匹配 workspace） | 尝试打开（VS Code 会处理外部文件） | `/etc/hosts` |
| 相对路径 | 基于 workspace cwd 解析 | `src/foo.ts:42` |
| 仅行号 | `path:line` | `src/foo.ts:42` → open at line 42 |
| 行列号 | `path:line:col` | `src/foo.ts:42:5` → open at line 42, col 5 |
| 行范围 | `path:start-end` | `src/foo.ts:5-10` → select lines 5–10 |
| GitHub 行范围 | `path#Lstart-Lend` | `src/foo.ts#L5-L10` → select lines 5–10 |

路径解析由 Host 侧完成（`applyHostMessage.ts` 中 `openFile` handler），Webview 只负责从文本中提取 path + line 并发送 `openFile` 消息。

### 4. 安全约束

- 仅响应用户主动点击，不做自动打开
- 路径通过 bridge schema 校验（`max(32_768)` 长度限制）
- Host 侧打开前验证文件存在（`stat`），不存在可 toast 提示

## 涉及文件

| 文件 | 变更 |
|------|------|
| `apps/vscode/src/webview/features/conversation/markdown/renderMarkdown.ts` | 新增 `code_inline` 渲染规则（方案 B）或文件链接解析工具函数 |
| `apps/vscode/src/webview/features/conversation/markdown/MarkdownHtml.svelte` | 扩展 `handleClick`，处理非 http(s) 链接 |
| `apps/vscode/src/shared/bridge/webviewToHost.ts` | 扩展 `openFile` 的行列及范围合约 |
| `apps/vscode/src/extension/webview-host/WebviewBridge.ts` | 基于当前 Session cwd dispatch `openFile` |
| `apps/vscode/src/extension/editor-context/openReferencedLocation.ts` | 解析相对路径并定位或选中范围 |

## 验收标准

1. 点击 `[src/foo.ts](src/foo.ts)` 格式的链接 → 在 VS Code 中打开 `src/foo.ts`
2. 点击 `` `src/foo.ts:42` `` 内联代码 → 在 VS Code 中打开 `src/foo.ts` 并跳转到第 42 行
3. 点击 `` `src/foo.ts:42:5` `` → 打开并跳转到第 42 行第 5 列
4. 绝对路径（匹配 workspace）可正确打开
5. 相对路径基于 workspace cwd 解析
6. 文件不存在时 toast 提示，不影响当前会话
7. http(s) 链接保持现有行为（调用 `openExternal`）
8. 非文件路径的普通文本和内联代码不受影响
9. 纯文本文件名（如 `AGENTS.md`）不自动渲染为链接
10. `` `src/foo.ts:5-10` `` 与 `[范围](src/foo.ts#L5-L10)` 打开文件并选中第 5–10 行
