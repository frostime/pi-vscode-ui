# R2a 次日人工验收

本候选包含 R1 和新增的 UI/Bridge 原位解耦，仍然是 VS Code 插件，**没有 Desktop 窗口或 Electron 依赖**。预期界面和使用方式不变。

建议直接验收本候选：先跑 R1 的核心功能，再补测下面 4 项。只有出现回归需要对比时，才回到保留的 R1 worktree；不要求把同一套用例重复做两遍。

## 启动本次候选

在 VS Code 新窗口打开：

```text
H:/SrcCode/playground/FrostPi/.worktrees/261019_desktop-bridge-inputs
```

在该窗口终端检查：

```bash
git branch --show-current
git rev-parse --short HEAD
git status --short
git merge-base --is-ancestor main HEAD; echo $?
git merge-base --is-ancestor refactor/desktop-host-boundary HEAD; echo $?
git diff --name-only eb05c72 HEAD -- apps packages scripts package.json pnpm-lock.yaml
```

分支应为 `refactor/desktop-bridge-inputs`。工作区应干净，两个祖先检查均为 `0`。已验证代码快照为 `eb05c72`；HEAD 可以包含后续文档提交，但最后一条源码差异检查应无输出。若不符，先让 Agent 按[结果报告](ui-bridge-inputs.RESULT.md)核对。

按 **F5 → Run FrostPi Extension**。等构建完成，在新开的 **Extension Development Host** 中打开可信的小测试项目，使用已有真实 Pi 配置。不安装 VSIX，不覆盖稳定插件。后续测试都在这个开发窗口中操作。

先执行 [R1 SOP 第 2 节的 T01–T07](R1-manual-test.SOP.md#2-核心用例)。**只复用用例，不使用其中旧 worktree 的准备步骤**。这会检查新建、流式、工具时长、Stop、后台并行、恢复、Usage 和基本布局。测试标记 A、B 沿用该 SOP。

## 本段重点补测

### C01 标签页与草稿交接

1. 在空闲会话 A 输入 `R2A-DRAFT-963`，不要发送。可附一张无敏感信息的小图片。
2. 打开会话右上角 **Session actions → Open in editor tab**。
3. 在编辑器标签页确认草稿和图片都在，将文字改为 `R2A-DRAFT-964`。
4. 在侧边栏切换到 B，再回到 A。A 的编辑器标签页必须仍显示 A，不能跟着侧栏变成 B。
5. 关闭 A 的会话标签页，回到侧栏 A。

**通过标准：** A 的最新草稿及图片回到侧栏，没有重复、丢失或发到 B。草稿交接不应自动提交消息。普通侧栏草稿的跨会话永久保存不在本段承诺范围内。

### C02 本地命令与外部草稿编辑

1. 先清空测试草稿。在侧栏 A 输入 `/editor R2A-EDITOR-975` 并发送。
2. 应打开临时 Markdown 编辑器，内容为 `R2A-EDITOR-975`；把内容改为 `R2A-EDITOR-976`，关闭该编辑器。
3. 检查 A 的输入框内容。也在 A 的会话标签页重复一次 `/editor` 流程。
4. 在侧栏发送不带图片的 `/resume`，确认打开已有会话选择器，用 Escape 取消即可。
5. 在 A 的会话标签页输入不带图片的 `/resume` 并发送。

**通过标准：** `/editor` 在两种位置都能打开临时编辑器，关闭后替换所属 A 的草稿，不直接发给模型。侧栏 `/resume` 打开恢复入口；标签页 `/resume` 提示去侧栏操作，并保留输入，不创建普通模型回合。

检查后手动清掉 `/resume` 测试输入。不要编辑项目中的真实源文件来代替临时编辑器，也不需要改变 question、代理或账户设置。

### C03 隐藏后恢复、字号与资源

1. 在 A 启动 R1 T04 的 30 秒工具命令。将 FrostPi 侧栏隐藏，再显示；会话标签页也切到其他普通文件，再切回来。
2. 检查新工具结果是否出现、卡片能否展开、输入框能否继续发送。
3. 若平时使用 VS Code Chat 字号或字体设置，临时调整熟悉的 `chat.fontSize`，观察现有视图及重新打开的会话标签页；检查后恢复原值。
4. 查看前面生成的 Markdown、代码块和图标。若常用 Mermaid、本地图片或 diff，按平时方式补测一次。

**通过标准：** 隐藏或切换不停止后台；回来后内容更新，不重复堆积；字号设置生效，图标和常用资源仍可加载。未使用的资源或主题写明未测，不按通过处理。

### C04 Usage 来源与缓存

1. 在侧栏打开 **Usage**，用已有配置完成一次可用 Provider 查询。
2. 关闭再打开，检查仍能看到原快照；不要求它后台自动刷新。
3. 切换到另一个会话，再查看同一 Provider。点击 **Refresh**，检查重新查询可以完成。
4. 打开会话标签页，确认仍没有新增 Usage 按钮。

**通过标准：** Usage 仍只在侧栏提供；关闭、切换和刷新不影响对话或草稿，不改变 Pi 模型。若当前 Provider 不支持查询或网络不可用，记录具体阻塞；不能把错误提示当成功查询通过。

## 把结果发回来

```text
候选提交：
环境 / VS Code / Pi / 模型：
R1 T01–T07：逐项填通过、失败、阻塞或未测
C01 标签页与草稿：
C02 /editor 与 /resume：
C03 隐藏恢复、字号与资源：
C04 Usage 与缓存：
其他常用功能：

问题：步骤 + 预期 + 实际 + 能否重复 + 脱敏截图/错误摘要
结论：候选正常，可讨论下一步 / 有回归，先修复 / 尚未测完
```

如果新候选有问题，保留现场。R1 对照位于 `H:/SrcCode/playground/FrostPi/.worktrees/261011_desktop-host-boundary`，分支 `refactor/desktop-host-boundary@acc25f2`；它未被本段改动覆盖。先反馈，不必重装、清空历史或修改账户来排障。

人工确认前不合入 main、不发布。完整 R1 与本段实测反馈由 Agent 一起记录；自动检查和静态审阅不替代这项确认。
