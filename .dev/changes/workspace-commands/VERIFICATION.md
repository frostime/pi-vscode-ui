# 命令整理验证

受测实现：`84e3783` 的提交前工作区。环境：Windows/MSYS、Node 24.12.0、pnpm 10.13.1、现有 Rust MSVC；未改测试时限或并发。

| 检查 | 结果 |
|---|---|
| `pnpm check` | 13 项 Node + 1010 项 Vitest 通过；含 lint、类型、JS 构建和体积检查 |
| `pnpm check:vscode` | 13 + 836 项通过；不执行 Desktop |
| 产品构建 | 扩展独立构建通过；Desktop 实际完成 Tauri/Cargo release 构建 |
| Cargo check/test | 通过；1 项 Rust 测试 |
| Desktop packaging 测试 | 20 项通过，含旧后台资源替换和复制范围 |
| VSIX 打包/验证 | 78 entries，通过；已实测拒绝含内部 build.mjs 的候选 |
| Desktop 打包/静态验证 | ZIP 清单/版本/哈希通过，exe 旁三份资源与 dist 哈希一致 |

日志确认：两条普通 gate 不调用 Rust；每次构建各共享依赖只准备一次。日志在忽略的 `tmp/workspace-commands-v2-*.log`。

产物 SHA-256：
- `FrostPi-0.16.0.vsix`：`e41930b7a7b02255beee5f010c8c3a2a8c8497e6a36eb141146448b56cd53655`
- `FrostPi-0.16.0-win32-x64.zip`：`ff87d8f6adff21c1c054b90abdbc1c2db89fae1047447ba133df621f1ce7505d`

Desktop ZIP 的构建来源为 dirty，只有静态检查，没有 GUI report，不能作为正式已验证交付物。未运行 GUI smoke、verify:desktop、人工验收、E2E、GitHub Actions 或真实模型；未推送/打 tag/发布，也未验证其他 OS/最低 Node。VSIX 最后补打包排除规则后重新打包验证，未重跑整轮应用测试。
