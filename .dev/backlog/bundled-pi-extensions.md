---
created: 2026-07-20
status: partially-implemented
feasibility-study: conducted
---

# 捆绑 FrostPi 私有 Pi Extensions

## 当前实现边界

会话树功能已落地一个 feature-specific bundled extension：`apps/vscode/pi-extensions/session-tree.ts` 构建为 `dist/pi-extensions/session-tree.js`，由每个 `SessionRuntime` 通过绝对 `-e` 路径注入。它使用 per-runtime token、OS 临时结果目录和 bounded metadata result；Host 通过 `get_commands.sourceInfo.path` 探测并隐藏其私有命令。

通用 bundled-extension RPC framework、统一 operation router 和 probe command 仍未实现。出现第二个实际 RPC capability gap 前，不从当前 feature-specific bridge 抽象通用平台。

## 目标

让 FrostPi VS Code 插件可以内置一组**只服务 FrostPi** 的 Pi extensions，并在启动 `pi --mode rpc` 时通过 `-e` 注入。

用途：当某项能力 Pi RPC 尚未暴露、但 Pi Core / Extension API 已具备时，FrostPi 可以用私有 extension 做受控适配，而不污染用户自己的 `.pi` 配置。

这是**通用基础设施**，不是某一个功能的实现。后续 tree 导航、或其他 RPC 缺口，都可以挂在这套机制上。

## 非目标

- 不把 FrostPi 私有逻辑写进用户 `~/.pi/agent/extensions`
- 不写进项目 `.pi/extensions`
- 不默认改写用户 `frostpi.pi.arguments`
- 不替代 Pi 原生 RPC；原生 RPC 仍是长期正路
- 不在本条目中实现具体业务能力（例如 `/tree`）

## 为什么需要

FrostPi 是 Pi 的 RPC client。理想情况下所有能力都走文档化 RPC。

但现实中会出现：

```text
Pi Core / Extension API 已有能力
→ RPC 尚未暴露
→ FrostPi 短期无法正式实现
```

此时有三条路：

1. 等 / 提 Pi 原生 RPC；
2. 让用户自己装 extension；
3. FrostPi 捆绑私有 extension，启动时 `-e` 注入。

第 3 条适合作为**受控过渡层**和**FrostPi 私有能力载体**：

- 不要求用户手工配置；
- 不污染用户 extension 目录；
- 版本随 FrostPi 发布；
- 可在 upstream 补齐后删除或降级。

## 可行性结论

**可以做到。**

### Pi 侧已支持

```bash
pi --mode rpc -e <path> ...
# 可多次
pi --mode rpc -e a.ts -e b.ts ...
```

已验证语义：

| 项 | 结论 |
|---|---|
| `-e/--extension <path>` | 额外加载指定 extension |
| 可重复 | 支持多次 `-e` |
| `--no-extensions/-ne` | 关闭自动发现，但显式 `-e` 仍生效 |
| 路径解析 | 相对路径相对 Pi cwd；应传绝对路径 |
| 用户/项目 extensions | 默认仍自动发现，与 `-e` 并存 |

证据：

- `pi --help`：`--extension, -e <path>`、`--no-extensions, -ne`
- `dist/cli/args.js`：解析 `-e` 到 `result.extensions`
- `dist/main.js`：`resolveCliPaths(cwd, parsed.extensions)` → `additionalExtensionPaths`
- `docs/extensions.md`：`-e` 用于显式加载；自动发现目录是另一条路径

### FrostPi 侧已有挂点

```ts
// SessionRuntime.#startInternal
const args = [
  ...configuration.piArguments,
  ...(sessionFile ? ["--session", sessionFile] : []),
];
// PiRpcConnection 再补 --mode rpc
```

因此 FrostPi 可在此处追加自有：

```ts
args.push("-e", bundledAbsolutePath);
```

不必改用户 settings，也不必写磁盘上的 Pi 配置。

## 推荐设计

### 目录

```text
apps/vscode/
  bundled-pi-extensions/
    README.md
    frostpi-bridge/                 # 示例形态；具体扩展按需增加
      package.json                  # 可选
      index.ts
```

也可先用单文件：

```text
apps/vscode/bundled-pi-extensions/frostpi-bridge.ts
```

### 启动注入

```ts
const bundled = context.asAbsolutePath("bundled-pi-extensions/frostpi-bridge.ts");
args.push("-e", bundled);
```

规则：

1. **绝对路径**：Pi cwd 是 workspace folder，相对路径会错；
2. **代码注入，不进用户配置**：不要默认写入 `frostpi.pi.arguments`；
3. **与用户 `-e` 并存**：用户自己在 arguments 里加的 `-e` 保留；
4. **默认保留用户 extensions**：不要默认加 `-ne`；
5. **随 VSIX 发布**：bundled 文件必须打进 extension 包，开发态与安装态都能 `asAbsolutePath` 解析到；
6. **失败可见**：文件缺失或 Pi 加载失败应进入诊断，不能静默当成能力存在。

### 命名约定

所有 FrostPi 私有 command / tool / status key 使用稳定前缀，例如：

```text
frostpi.*
```

示例：

```text
/frostpi.tree.navigate
/frostpi.session.ping
```

避免与用户 extension、prompt template、skill 冲突；也便于 FrostPi UI 过滤或隐藏。

### 能力发现

捆绑 extension 加载后，FrostPi 不应假设它一定存在。建议：

```text
启动
→ get_commands / 约定探测 command
→ 标记 bundledBridgeAvailable
→ 业务功能按能力开关
```

这样：

- 旧 Pi、加载失败、用户环境异常时可以降级；
- 将来切到原生 RPC 时，只需改能力后端，不改产品入口。

## 适用场景

适合放进 bundled extension 的能力：

- Pi Core/Extension API 已有，但 RPC 未暴露；
- 只服务 FrostPi 产品行为，不希望用户当普通 Pi extension 使用；
- 需要随 FrostPi 版本一起演进；
- 作为 upstream RPC 落地前的临时桥。

不适合：

- 已有稳定 RPC 的能力；
- 需要强类型、低延迟、严格 request/response 契约的长期协议；
- 大块产品业务逻辑（应留在 FrostPi Host/Webview）；
- 需要修改用户全局 Pi 行为、且用户无感知的危险操作。

## 风险与约束

1. **旁路协议**
   - 典型路径：`FrostPi → prompt(/cmd) → extension → Pi Core`
   - 比原生 RPC 更难观察、测试、版本协商

2. **返回值受限**
   - extension command 的公开返回往往弱于 Core API
   - 可能要靠 `set_editor_text`、session 再读取、自定义约定补齐

3. **slash 表面暴露**
   - `get_commands` 会看到这些命令
   - 需要前缀、文档和 UI 过滤策略

4. **安全与发行面**
   - Pi extension 拥有完整进程权限
   - bundled 代码等于 FrostPi 供应链的一部分，需审查、测试、版本记录

5. **打包/路径**
   - VSIX 必须包含文件
   - 远程 SSH / Windows 路径都要验证
   - 未打包成功时要失败明确

6. **生命周期**
   - session replace / reload 后 extension 会重建
   - FrostPi 不能缓存“旧 extension 实例还活着”的假设

## 与具体功能的关系

本条目只建立“能注入私有 Pi extension”的平台能力。

具体业务 backlog 可依赖它，例如：

- `support-session-tree.md`：在缺少 `navigate_tree` RPC 时，可用 bundled extension 调 `ctx.navigateTree()` 做过渡
- 未来其他 RPC 缺口：同样可挂临时 bridge，再在原生 RPC 就绪后删除

关系应是：

```text
bundled-pi-extensions   = 平台能力
support-session-tree    = 业务功能（可选用平台能力做过渡）
```

不要把某个业务实现细节写死成平台本身。

## 建议实现阶段

### Phase 0：基础设施

1. 增加 `apps/vscode/bundled-pi-extensions/`；
2. 启动 Pi 时自动 `-e` 注入绝对路径；
3. VSIX 打包/校验包含这些文件；
4. 诊断中显示 bundled extension 路径与加载结果；
5. 用一个最小 probe command 验证链路，例如 `/frostpi.ping`。

### Phase 1：能力约定

1. 统一前缀、错误码、日志红线；
2. Host 侧能力探测与降级开关；
3. 测试：有/无 bundled 文件、路径错误、与用户 extensions 共存。

### Phase 2：业务接入

各业务 backlog 在需要时接入，不在本条目展开。

## 验收标准

基础设施完成时：

- FrostPi 启动的 Pi 进程带有 bundled `-e` 绝对路径；
- 不修改用户 `~/.pi`、项目 `.pi`、默认 `frostpi.pi.arguments`；
- 用户自己的 extensions 仍可加载；
- VSIX 内包含 bundled 文件，干净安装后可用；
- bundled 缺失/加载失败时有明确诊断；
- 可用最小 probe 证明 Host ↔ bundled extension 通路存在。

## 关键锚点

Pi：

- `pi --help`：`-e/--extension`、`-ne/--no-extensions`
- `dist/cli/args.js`：CLI 解析
- `dist/main.js`：`additionalExtensionPaths`
- `docs/extensions.md`：extension 加载模型
- `docs/rpc.md`：RPC 下 extension command / extension UI

FrostPi：

- `apps/vscode/src/extension/sessions/SessionRuntime.ts`：启动 args 拼接点
- `apps/vscode/package.json`：`frostpi.pi.arguments`
- `docs/protocol/pi-rpc-compatibility.md`
- `scripts/package-vsix.mjs` / `scripts/verify-vsix.mjs`：打包校验需扩展

## 下一步

1. 确认 bundled 目录形态（单文件 vs 多 extension 目录）。
2. 实现启动注入与 VSIX 打包校验。
3. 加最小 probe extension + 单测/集成测试。
4. 再让具体业务 backlog 决定是否使用该桥，以及何时退回原生 RPC。

---

## 附录 A：Temp File 返回值模式

> 记录时间：2026-07-21

### 问题

RPC `prompt` 调用 extension command 的 response 不带 `data` 字段（`rpc-types.d.ts`：`command: "prompt"` 的 success 分支无反回 payload）。Extension command handler 的返回值被 RPC 层丢弃。

这意味着 extension command 只能是 `f()`（fire and observe），无法做到 `result = f()`（request-response）。

`extension_ui_request` 子协议有固定 method 集合且无 correlation ID，不适合承载任意结构化返回值；用 stdout 时序做隐式关联并发不安全。

### 方案：Temp file 旁路

FrostPi 在调用 extension command 前创建一个临时 JSON 文件，路径通过 slash command 参数传入。Extension handler 将结构化结果写入该文件，FrostPi 在 `prompt` response 到达后读取。

```text
FrostPi                                    Pi (RPC)
   │                                          │
   ├─ fs.mkdtemp() → /tmp/frostpi/r-<uuid>.json
   │                                          │
   ├─ prompt("/frostpi.tree.navigate          │
   │     --result-file /tmp/frostpi/r-xxx     │
   │     --target-id abc123                   │
   │     --summarize")                        │
   │                                          │  handler 执行
   │                                          │    ctx.navigateTree(id, opts)
   │                                          │    // 从 args 解析 result-file
   │                                          │    // 通过 ctx.sessionManager 查询 post-navigation 状态
   │                                          │    writeFileSync(resultFile, JSON.stringify({...}))
   │                                          │
   │◄── response ────────────────────────────┤  handler 结束
   │                                          │
   ├─ readFileSync(tmpFile) → 结构化结果
   ├─ unlink(tmpFile)
```

### 关键性质

| 维度 | Temp file | `extension_ui_request` 旁路 |
|------|-----------|------------------------------|
| correlation | UUID 文件名 = 天然 ID | 依赖 stdout 时序假设 |
| 并发安全 | ✅ 每个请求独立文件 | ❌ 不能同时发两个 command |
| 结构化数据 | ✅ 任意 JSON | ⚠️ 受限于 9 种固定 method |
| 其他 extension 干扰 | ✅ 完全隔离 | ⚠️ 其他 extension 的 `notify` 等会交叉 |
| 数据量 | 无上限 | `set_editor_text` 单字段，`notify` 单行 |

### 合法性依据

1. **Node built-ins 可用**：[`docs/extensions.md`](C:\Users\EEG\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\extensions.md) 的 "Available Imports" 表格末尾明确声明 `node:fs`、`node:path` 等 Node.js built-ins 可用

2. **Pi RPC 已有文件旁路先例**：
   - `bash` 命令 → `fullOutputPath`：结果过大时写 temp 文件
   - `export_html` 命令 → `outputPath`：导出到指定文件路径

3. **Temp 文件生命周期由 FrostPi 管理**：在 OS temp 目录创建和清理，不污染 workspace、不进入用户视野

### 使用约定

- Temp 文件由 FrostPi 创建（`fs.mkdtemp`），路径通过 slash command 参数传入
- Extension 只写不删（删除由 FrostPi 负责，包括异常路径）
- 文件名使用 UUID 避免预测和冲突
- Extension 写入失败不应阻塞主流程（try/catch + 写 error 字段到 result file）
- 此模式仅用于 bundled extension 和 FrostPi 之间的私有通信，不作为用户可见 API
