---
name: slsp
description: Use `slsp` (LSP CLI) in this repo to get semantic code facts — symbols, hover, definition, references, rename preview — and to validate edits with diagnostics. Verified for TypeScript (`packages/pi-rpc`, `apps/vscode`) and Svelte (`apps/vscode/src/webview`). For locating unknown text first, use `rg`.
---

# slsp

LSP 语义查询 CLI，给 Agent 提供类型/定义/引用等可靠事实，替代 grep 猜测。语法细节看 `slsp --help`（会打印内置文档路径）。

依赖 npm 包 `simple-lsp-cli`。

## 使用规则

- `--line` / `--col` 是 **1-based**
- 结果要解析/转发时加 `--format json`
- `rename` / `format` / `code-actions` 只输出编辑预览，**不修改文件**

## Common commands

### symbols — 新文件先跑，摸清结构

```bash
slsp symbols -f packages/pi-rpc/src/PiRpcConnection.ts
```

### hover / definition / references

```bash
slsp hover       -f packages/pi-rpc/src/PiRpcConnection.ts -l 60 -c 20
slsp definition  -f packages/pi-rpc/src/PiRpcConnection.ts -l 60 -c 20
slsp references  -f packages/pi-rpc/src/PiRpcConnection.ts -l 46 -c 17
```

### rename（预览，不变更）

```bash
slsp rename -f packages/pi-rpc/src/PiRpcConnection.ts -l 46 -c 17 --new-name NewName
```

### diagnostics

```bash
slsp diagnostics -f apps/vscode/src/webview/App.svelte
```

## Default path

- 先 `rg` 定位位置，再用 slsp 取语义事实（rg discovers, slsp explains）
- 每次代码编辑后跑 `diagnostics`，空结果 = 无类型/语法错误
- daemon 自动保持会话（~1s/调用），`slsp daemon status` 可查

## Gotchas

- `slsp servers -f <file> --format json` 里 `diagnostics: unknown` 是 tsserver 正常现象，照用
- 本项目两个 TS 根（`packages/pi-rpc`、`apps/vscode`）+ Svelte（webview），全部命令实测可用，无需项目配置
- 不要对 `apps/vscode/.vscode-test/` 里的文件跑 slsp（内置 VS Code 源码，项目巨大）
- Bundler moduleResolution + `.js` 后缀 import 的 definition quirk 实测未命中；若 definition 落在 import 语句上，用 `rg "export.*<name>"` 兜底
- 搜索类命令（completion 等）在 `--help` 里有完整选项，此处只列常用路径

## Failure handling

- `config_error` → 读 `slsp --help` 打印的 config 文档
- `ENOENT` / `Cannot start` → 语言服务器二进制缺失
- `unsupported_capability` → 换别的命令或用 `rg`
- 结果可疑 → `slsp servers -f <file> --format json` 核对 root/能力，再退回 `rg`
