# Markdown 图片渲染

## Problem Statement

FrostPi 的消息 Markdown 会把图片语法解析成 `<img>`，但目前 Webview 无法正确访问其来源：网络图片被内容安全策略阻止，相对路径错误地相对于 Webview 页面解析，本地绝对路径和 `file:` URI 也不在 Webview 的资源权限内。结果是消息中的 `![alt](source "title")` 通常只能显示为破损图片。

本变更要让 Markdown 消息中的图片成为可用、可控的会话内容：本地图片自动显示，网络图片只有在用户明确操作后才访问，SVG 主动内容不会运行，图片尺寸不会破坏消息布局或造成明显的解码风险。

## Approach

Markdown 渲染器不直接输出带原始 `src` 的图片，而是输出经过清理的惰性占位符。Webview 根据来源决定展示和加载行为：HTTPS 图片等待用户点击，本地来源通过 Host–Webview Bridge 请求 Extension Host 读取，`data:` 图片在 Webview 内处理。

Extension Host 以发起请求的 Connection 当前显示 Session 为授权上下文。相对路径以该 Session 的工作目录为基准；绝对路径和 `file:` URI 可读取 Extension Host 进程能够读取的任意普通文件。读取结果经过字节数、格式及可取得的固有尺寸验证后返回原 Connection。

这一方案不扩大 Webview 的 `localResourceRoots`，也不把展示期图片数据写入 Conversation ViewModel、Pi RPC 或会话持久化内容。

## Behavior Contract

### 来源

- 相对路径以当前 Session 的 `cwd` 为基准。
- 支持 Extension Host 所在文件系统上的 Windows/POSIX 绝对路径。
- 支持合法的 `file:` URI，包括平台能够解析和读取的文件位置。
- “本地”在 SSH、WSL 和 Dev Container 中指 Extension Host 与 Pi 所在的远程环境，而不是运行 VS Code UI 的机器。
- 支持现有合法的 `data:image/...` 来源。
- 网络来源仅支持 HTTPS。HTTP 和其他协议显示不支持状态，不自动访问。
- 本地与 `data:` 图片在接近视口时自动加载；HTTPS 图片即使进入视口也必须由用户点击加载。
- HTTPS 请求由 Webview 的隔离图片上下文直接发起，并使用无 Referrer 策略；FrostPi 不代理、重试或持久缓存网络图片。

### 格式与安全

- 本地图片支持 PNG、JPEG、WebP、GIF 和 SVG。
- 文件类型根据内容识别，不只相信扩展名或 URI 后缀。
- 本地文件必须是普通文件；本地与 `data:` 图片均受当前图片附件字节限制约束，默认上限为 10 MiB。
- 可取得固有尺寸的位图受最大单边 16,384 px、最大总像素 40,000,000 px 限制；本地位图在传输前检查，网络与 `data:` 位图在浏览器解码后检查。
- SVG 受合理的固有尺寸约束；字节限制同时约束其结构复杂度。
- 本地和 `data:` SVG 在 Webview 中清理后才作为 Blob 图片显示。脚本、事件属性、`foreignObject`、动画及外部资源引用不运行；只保留安全的静态内容和本地片段引用。
- SVG 被移除主动内容但仍可显示时，图片下方显示低强调度警告。清理后没有安全可渲染内容时显示阻止占位。
- 用户点击加载的远程 SVG 仅作为 Chromium 隔离的 `<img>` 图片显示。由于跨域限制，FrostPi 不承诺检查或报告其内部主动内容，也不执行其中的脚本。
- 不在诊断日志中记录消息正文、图片内容、本地路径或网络 URL。

### 显示与交互

- 图片保持固有宽高比，不裁切、不主动放大小图。
- 普通消息内最大宽度为消息可用宽度，最大高度为 `min(480px, 60vh)`；窄视图不得产生水平滚动。
- Lightbox 中图片最大约为 `92vw × 86vh`，仍保持比例。
- 显式 title 作为图注；没有 title 时，长度不超过 160 个 Unicode 字符的简短 alt 也作为图注。过长的 alt 只用于无障碍名称和失败回退。
- 图片与图注不使用整体外框或卡片背景；图片自身保留轻微圆角。
- 未加载的网络图片显示来源域名、可用标题和“加载图片”操作。
- 本地读取中、找不到文件、超限、格式不支持、SVG 被阻止和浏览器加载失败均使用图片位置内的状态，不弹全局 Toast。
- 已加载图片可点击并通过键盘打开 Lightbox。若图片被 Markdown 链接包裹，则保留链接行为，不以 Lightbox 覆盖链接。
- 图片状态和警告不能只依赖颜色表达，并需适配 VS Code 浅色、深色和高对比度主题。

## Implementation Decisions

- Markdown 图片规则生成无副作用占位符，原始来源在通过属性转义和 HTML 清理后才进入展示控制器。
- Webview 图片组件拥有加载、失败、图注、SVG 警告和 Lightbox 状态。
- Webview 图片客户端拥有 Bridge 请求关联、迟到响应丢弃、进行中请求去重和有界内存缓存；缓存不持久化。
- Extension Host 图片解析器集中拥有本地路径解析、文件读取、格式识别、字节与位图尺寸限制。
- Bridge 请求携带请求 ID、当前 Session ID 和图片来源。Host 必须使用 Connection 上下文重新授权 Session，结果只返回发起请求的 Connection。
- 图片普通失败通过结构化失败原因返回；意外异常在不记录敏感来源的前提下归一为内联读取失败。
- Blob URL 的创建和撤销属于挂载该图片的 Webview 组件生命周期。
- 图片数据是展示期资源，不改变 conversation content revision，不成为消息附件，也不进入 Session 持久状态。

## Acceptance Criteria

- `![alt](./image.png "title")` 能相对于 Session 工作目录显示受支持图片，title 居中显示且没有整体外框；没有 title 时，简短 alt 也能作为图注显示。
- 本地绝对路径和合法 `file:` URI 能显示 Extension Host 可读的受支持图片。
- HTTPS 图片在用户点击前不会产生网络图片请求，点击后能够加载并可打开 Lightbox。
- HTTP、未知协议、目录、缺失文件、格式伪装、超出字节或尺寸限制的文件均不会显示为可信图片，并给出内联状态。
- 本地和 `data:` SVG 的脚本及外部资源不会执行；发生清理时可见警告，无法安全渲染时显示阻止状态。
- Markdown 原始 HTML 仍保持禁用，既有链接、文件引用、代码块、数学公式和 Mermaid 行为不回退。
- 流式更新不会为同一个已完成图片语法持续重复读取本地文件，已销毁图片不会接受迟到响应。
- 图片在 280px 宽度、VS Code 浅色、深色和高对比度主题下可读、可操作且不引发水平滚动。
- 相关单元测试通过，`pnpm check` 通过。

## Review Artifact

[`prototype.html`](prototype.html) 是已确认的视觉和交互原型。它确认图注居中、无整体外框、网络图片点击加载、SVG 警告和 Lightbox 方向；其中示例内容和精确颜色不属于生产合同。
