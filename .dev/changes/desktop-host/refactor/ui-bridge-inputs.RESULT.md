# R2a：UI/Bridge 原位宿主输入解耦结果

## 结论与运行入口

R2a 已完成实现、独立静态审阅和自动验证，等待用户运行。它包含 R1，但不把延后的 R1 人工验收标为通过。**没有创建 Desktop、安装 Electron 或提取共享 UI 包。**

- 分支：`refactor/desktop-bridge-inputs`。
- 工作目录：`H:/SrcCode/playground/FrostPi/.worktrees/261019_desktop-bridge-inputs`。
- 生产实现：`45a2e72`；完整验证代码快照：`eb05c72`。两者只相差一处测试断言的 lint 修正，生产代码一致。后续报告、SOP 和规划提交不改变该实现。
- 原 R1 对照：`.worktrees/261011_desktop-host-boundary`，`refactor/desktop-host-boundary@acc25f2`，保留且未修改。
- 本地 main 基线仍为 `2ed69c1`；顶层、R1 及 R2a 均包含该基线。R2a 也包含顶层文档提交 `cd32f60`，记录用户允许先推进、次日验收的更新授权。

人工入口见 [R2a 次日验收 SOP](ui-bridge-inputs.SOP.md)。建议在新 worktree 按 F5 → **Run FrostPi Extension**，一次完成 R1 核心用例与本段补测。出现回归时再用原 R1 候选定位，不必默认把整套测试做两遍。

main 和已安装插件未改，未推送、发布、安装 VSIX，也未将生产代码合入顶层规划分支。

## 实际改动

以下代码路径均相对于 R2a worktree。

| 边界 | 实现与保持项 |
|---|---|
| 浏览器消息传输 | 新增 `apps/vscode/src/webview/bridge/hostBridge.ts`，由 `main.ts` 在 mount/ready 前显式连接。业务组件使用同一 Bridge API，不查询 VS Code 全局；未连接明确报错，不再空发 |
| VS Code 适配 | `bridge/vscodeBridge.ts` 只提供原生 transport 工厂，延迟获取 API，每文档复用一次。断开释放订阅，旧清理不会断开新挂载 |
| Host 端点 | `webviewTypes.ts` 不再暴露完整 `vscode.Webview`；Sidebar/Panel 适配最小收发和可见性端点，保留 postMessage 的 false/rejection 语义 |
| Connection 输入 | 文件搜索实例和字体 reader 由 Coordinator 提供；每 Connection 独立搜索、旧 fd 提示触发时机、ready 时读取最新字体均保持 |
| 聊天宿主输入 | SidebarShell/PanelShell 显式提供本地命令处理与发送失败恢复责任；Composer 先应用草稿转换，再调用动作，不再根据 surfaceKind 猜测这些责任 |
| Provider Usage | Shell 提供既有安全 source；Metrics 每次挂载只创建一次缓存。Session/model 切换不改变缓存归属；Panel 仍不提供 Usage |

Bridge 3.3、schema/version/目标授权、快照/增量与失败恢复、关联 ID、Registry、草稿权威、集合策略、批注清理、Pi 交互、资源布局和持久化均未改变。主题和 CSS 无新增产品样式。最近 Composer/Provider Usage/Bridge SPEC 与架构 overview 随实现更新。

## 自动验证

全部命令在 R2a worktree 执行。使用隔离的 `tmp/ui-bridge-agent` 作为 `PI_CODING_AGENT_DIR`，测试依赖受控 fake Pi 和合成 Provider 数据，未启动真实用户 Pi 或查询真实 Provider 账户。

| 检查 | 结果 | 日志（候选 worktree 的 tmp 内） |
|---|---|---|
| frozen offline install 复核 | exit 0，lockfile 无变更，无新依赖 | `ui-bridge-install-verify.log`、`ui-bridge-install.exit` |
| 相关局部回归 | 13 文件、60 项通过，exit 0 | `ui-bridge-local-tests.log/.exit` |
| 完整 `pnpm check` | exit 0；lint、全部类型检查、构建及预算通过；120 文件、799 项全部通过 | `ui-bridge-final-check.log/.exit` |
| `pnpm package:vsix` | exit 0；`artifacts/FrostPi-0.15.5.vsix`，78 entries、2.65 MB | `ui-bridge-final-package.log/.exit` |
| `pnpm verify:vsix` | exit 0 | `ui-bridge-final-verify-vsix.log/.exit` |
| 标准 `test:e2e` | exit 0；VS Code 1.142.0，隔离合成 workspace、fake Pi | `ui-bridge-final-e2e.log/.exit` |

完整测试分布：RPC 43、provider-usage 162、pi-client 165、插件 429。相对 R1 新增 15 项，主要覆盖显式 transport 生命周期、两端无 vscode API 的 ready/snapshot 链路、送达失败恢复、真实 Composer DOM 的本地命令与草稿恢复、Usage 注入后的缓存和取消。

最终预算：extension.cjs 1094.3 / 1171.9 KiB，webview.js 809.8 / 830.1 KiB，webview.css 150.6 / 156.3 KiB。

首轮完整检查曾因新增测试中的嵌套 matcher 触发 unsafe-assignment lint 而失败；已改成等价的分项断言，未放宽规则，再从完整 check 重新跑到 E2E，均捕获实际 exit 0。首次安装外层等待超时没有留下 exit，之后 frozen offline 复核退出 0，不以超时当成功。

E2E 对该命令清除继承的 `ELECTRON_RUN_AS_NODE`，没有修改产品启动策略。它只检查扩展激活、命令注册与 fake Pi 新建/停止，**不证明浏览器真实交互、真实 Pi 或资源视觉均正常**。既有 Svelte tabindex、Vite chunk、Node/VS Code 测试环境警告仍在；不作为通过证据，实际断言和退出码为准。

## 独立审阅

同当前主模型的独立只读 reviewer 审阅 `45a2e72^..45a2e72` 的全部 47 文件差异，重点检查启动与订阅、送达布尔/rejection、配置读取时机、命令/草稿/附件、Usage 缓存和导入迁移，未发现有具体代码证据的新回归或维护性问题。主 Agent 复核了关键差异，并核对测试日志及实际退出码。

后续 `eb05c72` 仅调整测试断言，不改变生产逻辑；该测试的局部 lint/执行和最终完整检查均通过。静态审阅不代替人工确认。

## 限度与后续边界

- 仍需用户使用真实 Pi、自己的可测试历史及常用插件能力运行 SOP；远程、其他平台、视觉/输入法/字体/Mermaid/图片未由本轮自动化完整验证。
- App、Shell、聊天组件及 Connection 仍归属 VS Code app。本段没有声称全部 UI 已宿主无关；`PromptEditor` 的命令再组合、编辑器 mentions、资源与主题入口等仍需在实际共享 UI 提取时继续处理。
- `PromptEditor` 二次组合命令可能补回 Panel `/resume` 补全，这是基线既有行为，本段未修；显式提交仍按原规则拒绝。不能把它算成本段新增回归，也不能因此声称完整能力边界已完成。
- 当前 UI stores 仍按一文档一个 presentation 使用，不承诺同页独立多聊天根，也未决定 Project 切换时的草稿/批注保留。
- 本段没有技术阻塞。下一段须先据实测反馈确定共享聊天/资源的提取范围；Project 集合、Desktop 能力、草稿生命周期和退出/恢复规则仍是用户取舍，不用新接口或默认实现代替决定。

本段到可验收检查点即停止。用户反馈后再决定整合与下一段，不自动继续 Electron 或多项目实现。
