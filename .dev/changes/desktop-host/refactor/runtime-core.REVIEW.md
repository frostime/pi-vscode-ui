# R1 独立审阅：可进入用户实测

本文件保留旧 `efa9c78` 的审阅快照。当前 main 已升级并完成同步，最新基线、候选及验证见 [main-sync.RESULT](main-sync.RESULT.md)，不要把旧候选当作最新版本运行。

## 结论与候选

候选分支 `refactor/desktop-host-boundary`，最终候选 `efa9c78`，实施 worktree 为 `.worktrees/261011_desktop-host-boundary`。基线 `370e30b`；职责变更在 `078895d`，提取在 `35a0f41`，`eda49f2` 记录验证，`efa9c78` 补齐两项审阅收尾。

**未发现阻塞性的生产实现或范围问题，可以进入用户实测。** 这不是 R1 整体完成、用户验收、真实 Pi 体验或后续阶段实施许可。候选代码未整合到顶层/main，也未安装覆盖稳定插件。

实施结果位于候选分支的 `.dev/changes/desktop-host/refactor/runtime-core.RESULT.md`；本地可在实施 worktree 阅读，或通过 `git show efa9c78:.dev/changes/desktop-host/refactor/runtime-core.RESULT.md` 恢复。主计划仍在 [ORCH](../desktop-host.ORCH.md)，范围以 [Ticket](runtime-core.TICKET.md) 为准。

## 审阅内容

S528 阅读两次代码提交、最终收尾差异及验证材料；两项只读独立 review 分别覆盖包/构建接线与测试/契约文档。review 没有写实施 worktree，也没有重复运行实施者的测试、构建或安装。

- Runtime 的实际职责变化限于配置刷新/启动时的动态代理读取、版本值、日志与只读凭据类型、纯脱敏模块。Registry 的工作区、选择、Fork、恢复、队列等策略没有改变，创建接线保留原 cwd/URI 查询方式。
- 独立逐文件比较 `078895d` 与提取后的源文件：39 个迁移 TypeScript 文件归一换行后完全一致。新增的是 core/shared 包入口，不是第二份 Runtime。该比较支持机械迁移判断，不替代宿主输入或构建验证。
- Bridge、Coordinator、DraftCache 的差异只有共享类型/协议导入；原 Webview 组件、Persistence 与 Pi RPC 实现没有改变。全部纯 shared 子树迁移在已接受范围内，不表示 UI/Bridge 已共享化。
- 包独立声明依赖，core/shared 子入口不使用混合根 barrel；源码映射、构建产物及 JS/d.ts 入口可区分。插件本地构建和 F5 的共享依赖顺序保留，不需要 Desktop。
- 移动后的原有测试没有删除关键行为断言；fake Pi fixture 仍是单一来源，设置隔离不依赖真实用户 Pi 配置。构建/入口证据支持宿主类型与 Node/browser 图隔离。

## 两项审阅发现与闭合

| 发现 | 最终处理与证据 |
|---|---|
| 新宿主输入测试用强制刷新，不能单独证明新代理触发 fingerprint 更新 | `efa9c78` 改为先无强制刷新确认 false，仅改代理后再次无强制刷新确认 true、仍 running、原进程环境不变，随后改变凭据并重启验证新值。复核差异及 `tmp/followup-host-input-tests.log`，1 项通过；Runtime 未改变 |
| 根 clean 没有编排新客户端包的 clean | `efa9c78` 增加 client clean。复核根脚本及 `tmp/followup-clean.log`/`followup-build.log`，客户端 dist/coverage、RPC/插件 dist、artifacts 被清理并正常重建。没有引入另一套清理实现 |

不要求为这两项范围内修复新增运行时机制，也没有把它们升级成全量架构重做。

## 验证证据与限度

S528 已阅读实施 worktree 的完整检查日志、最终退出码、受控 E2E 退出结果、入口/声明/依赖图摘要、VSIX 校验及后续窄验证日志。

- `35a0f41` 的完整 `pnpm check` 最终退出 0：575 项测试、lint/typecheck、构建和预算。首次 Windows 子进程环境失败与重跑在 RESULT 单独记录。
- 受控 Extension Host E2E 清除继承的 `ELECTRON_RUN_AS_NODE` 后退出 0；使用 fake Pi，不是真实本机 Pi。
- 默认导出消费者的受控 Runtime 流、41 份声明、Node/browser 依赖图检查通过。
- `efa9c78` 只改测试、根 clean 和 RESULT；追加窄测试、客户端类型检查/typed lint、clean/build、编译产物入口及打包验证。没有将旧全量检查冒充成最新提交重新跑过的检查。
- 最终 VSIX 已重新生成并校验，78 entries、2.51 MB；未自动安装。新候选的构建产物可供 F5 使用。

真实用户 Pi/OMP、历史数据、远程 SSH/WSL/容器、其他系统、最低 VS Code 版本以及完整视觉回归仍未被这些证据覆盖。用户运行反馈是下一道强制门槛。

## 用户入口与停止条件

已复核候选的 `.vscode/launch.json` 和 tasks：在 VS Code 新窗口打开实施 worktree 根，按 F5 选择 `Run FrostPi Extension`，会执行 `build:debug` 并从该 worktree 的 `apps/vscode` 启动开发插件。不要在主工作区按 F5；先不安装候选 VSIX覆盖稳定版。

在 Development Host 使用熟悉的本机项目与真实 Pi，检查新建/恢复、流式结果与 Stop、会话切换及常用功能。具体步骤与清单见候选 RESULT。

用户确认功能正常前，停在 R1，不合并候选、不推送、不发布、不继续 UI/Bridge/Desktop。发现回归则由实施者在本范围修复，再独立复核和实测。
