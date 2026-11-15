---
title: 合并上游 PR #12 与 #17 到 quasi-main
created: 2026-11-15T04:59:11+08:00
consumed: true
---

# Handover: 合并上游 PR #12 与 #17 到 quasi-main

## Integration Result — 2026-11-15

**#17 与 #12 已合入 `quasi-main`，不再处于等待合并状态。** 用户授权了本地集成，没有授权推送或发布。以下 `Assume Reader` 起为原始交接历史，不能据其中的旧分支状态重复执行合并。

### 已合入的内容

- #17：合并提交 `8d06e4b`。只接纳复制修复 `73b3947`，没有带入上游的定版提交 `a39b575`。本机 VS Code 1.146.0 已有宿主侧选区保护，因此不是所有版本都能复现原故障；浏览器对照确认 FrostPi 修复适用于旧宿主逻辑且不破坏新逻辑。
- #12：合并提交 `fb72d2f`。从上游 `0ac4391` 衍生的 `fix/pr12-windows-image-tests` 已与本地成果、#17 组合验证；集成分支最终代码为 `e37fdcb`。合并后的树与该验证分支完全一致。
- `fb72d2f` 正文已写 `Closes #16`，对应 #17 的复制问题。尚未推送默认分支，不代表 GitHub Issue 此时已关闭；后续合入 `main` 时保留此关联。
- CHANGELOG 将两项PR及图片兼容修正整理进 `[Unreleased]`，保留本地0.16.6发布历史。版本仍为0.16.6；0.16.7定版、推送、tag与发布是后续授权事项。#13/#14仍不在本次范围。

### 集成时完成的修正

Windows图片路径测试已隔离真实磁盘与网络共享：拒绝路径断言零文件系统访问，允许路径断言准确读取；真实文件用例保留临时目录。没有为测试扩张产品接口。一次性移除保护后，16个拒绝用例失败，恢复后全绿。

正文图片支持PNG/JPEG/WebP/GIF/AVIF/BMP/SVG，覆盖本地文件、支持的内嵌data及显式HTTPS加载；模型附件格式仍为原有PNG/JPEG/WebP。原生烟测发现Markdown解析器会在组件之前拒绝AVIF/BMP内嵌图片，`e37fdcb`已修正图片语法的入口校验，并验证普通链接策略没有放宽。

用户接受保留默认10 MiB限制。VS Code与Desktop的设置说明已明确：超限粘贴图片不能作为附件添加，超限本地文件/HTTPS正文图片不能加载。设置键不变，Desktop已有入口为 Settings → Conversation & Pi → Reading & input → Image size limit，以MiB编辑。

### 组合验证证据

以下结果针对 `e37fdcb`，不是仅对上游PR单独验证：

- `pnpm check`成功：1242个包测试通过，1个既有平台条件用例跳过，13个工程脚本测试通过；lint、类型检查、双产品JS构建与包体积检查通过。`webview.css`为156.0 / 156.3 KiB。
- `pnpm package:vsix` 与 `pnpm verify:vsix`成功；验证包为 `.worktrees/pr12-windows-image-tests/artifacts/FrostPi-0.16.6.vsix`，仅作集成验收，不是0.16.7发布包。
- 完整Desktop原生构建与GUI smoke成功。真实WebView2验证了Mermaid资源、AVIF/BMP本地及内嵌图片解码、放大预览、远程图片加载入口，以及CSP拒绝直接远程图片请求；其余既有的双Project并行、Settings、窗口/进程生命周期检查也通过。
- 无头Edge共享组件检查覆盖两种格式各自的本地、内嵌data、HTTPS加载流程。HTTPS正向用例使用注入传输响应；此前会话对相同loader做过真实HTTPS/代理实验，不能将该历史证据描述成本轮完整Extension Host验收。

日志位于 `.worktrees/pr12-windows-image-tests/tmp/`：`integration-final-check.log`、`integration-final-package-vsix.log`、`integration-final-verify-vsix.log`、`integration-desktop-build-final.log`、`integration-desktop-smoke-final.log`。原生smoke的完整结果目录见最后一份日志。工作树及分支保留，便于核查产物。

### 已知边界，不作为本次合并阻塞

SOCKS与Remote-SSH图片场景由用户明确排除本轮范围。图片失败后原地手动重试、诊断规则误删某些普通错误字段仍是未修改的改进项，不能宣称已经解决。此次没有运行官方VS Code完整GUI验收、真实模型请求或tray右键Exit的人工验收；原生smoke已明确保留其人工检查边界。

## Assume Reader

读者是 FrostPi 仓库的新 Pi 会话，拥有工作区和 `AGENTS.md`，没有本会话的任何记忆。工作区状态：

- 当前分支 `quasi-main`，HEAD `64c7ec2`，工作树干净，与 `origin/quasi-main` 同步。
- 该提交等于已发布的 `v0.16.6`（`main` 同在 `64c7ec2`）。0.16.6 已于 2026-11-14 正式发布（Marketplace、Open VSX、GitHub Release、Desktop ZIP/MSI 均成功）。
- 仓库协议见 `AGENTS.md`；合并规范见 `C:\Users\EEG\.pi\agent\skills\#code-engineering\git-branch-workflow\SKILL.md`（合并须 `--no-ff`，合并前保证测试通过）。
- 双产品归属与首次验证选择见 `H:\SrcCode\playground\FrostPi\.agents\skills\dual-maintenance\SKILL.md`。

先读本文全部内容再动手；`Source Session` 仅在遇到未覆盖疑问时使用。

## Source Session

本会话记录：`C:\Users\EEG\.pi\agent\sessions\--H--SrcCode-playground-FrostPi--\2026-11-14T08-29-15-795Z_01a1d92c-d293-76fd-b580-0f81f4f7396f.jsonl`。

Search anchors（用 `read-pi-session-history` 检索该文件，仅在本文信息不足时查证细节）：

- `spawn EINVAL` — 关于一次已自愈的 Desktop 启动失败，用户决定"先不管"，不展开。
- `#17` / `73b3947` — #17 的复制修复审查与浏览器复现。
- `redactSecretAssignments` — #12 的诊断脱敏审查发现。
- `0.16.6` / `64c7ec2` — 发布安排与执行记录。

## Background & User Guidance

用户的版本安排（已确认的决定）：

> 我们当前这个自己开发的版本，先去做发版。然后，我们在新的 main 上专门去做合并 #17 和 #12 然后发版，然后把 13 14 作为 0.17？

即 0.16.6（本地成果）已发布完毕；下一步是把上游 PR #12 与 #17 合入 `quasi-main`，完成后发布 **0.16.7**。#13、#14 留到 0.17 周期，**不预承诺原样合入**。用户最新指示：

> 下面回到 quasi-main，同步 main，然后编写一份 handover 文档，下面我会开新 session 去做合并

因此读者的任务是：**审查确认 → 隔离试合 → 修复已知测试缺陷 → 验证 → 合入 quasi-main**。默认不合并、不打 tag、不推送；每一步完成或遇阻时向用户汇报，合并入 quasi-main 与后续 0.16.7 发版需用户再次确认。

## Trajectory

以下是上一会话已完成的评估，读者据此决策，不必重复调查：

1. **候选筛选（已确认）：** 四个开放 PR 中，#13（会话生命周期、多项命令、默认开启的 Focus View）与 #14（依赖 #13 的 draft，新增 `/btw` 模型请求路径）超出本次补丁范围，留待 0.17。#12 与 #17 被选定为本版本候选。PR 现状：#17 head `a39b575`，#12 head `0ac4391`（本地已 fetch 对象，无需重新拉取）。

2. **#17 审查（verified）：** 只含两个产品行为——transcript 滚动容器加 `tabindex="-1"`（保持拖选不被 VS Code 的 `execCommand` 焦点恢复破坏）；隐藏的 Copy/Wrap/消息操作按钮在不可见时退出 hit-testing。修复提交为 `73b3947`；其第二个提交 `a39b575` 是 `0.16.6` 定版（package.json 版本 + CHANGELOG），**必须剥离**——版本与 CHANGELOG 由我们在 0.16.7 统一处理。上一会话用真实 Chromium 复现：旧代码拖选后 `Ctrl+C` 焦点跳到 Composer、复制为空；修复后复制成功且隐藏按钮不再命中。证据在 `G:/Enviroment/msys2/tmp/frostpi-pr-candidates-S3LF8c/pr17-browser-result.json`（临时目录，可能已清理；重建成本低）。维护性无不当扩张：未新增自定义剪贴板机制。#17 与 quasi-main 的合并探测只有 `CHANGELOG.md` 文本冲突。

3. **#12 审查（verified，一处测试缺陷待修）：** 内容为渲染依赖补丁升级（Mermaid 11.16.1、markdown-it 14.3.3、DOMPurify 3.4.17、KaTeX 0.18.2、新增 undici 7.28.0）、Webview CSP 收紧（去掉 `img-src https:`，改为 Host 代理取图）、Mermaid sanitizer 第二层资源清理、`/editor` 草稿改私有目录、诊断导出去掉 Pi stderr 正文并加强脱敏、Windows 拒绝网络共享/设备路径的本地图片。维护性结论：无阻塞的结构问题，机制集中（远端图片经 `RemoteMarkdownImageLoader.ts`，复用既有代理策略），未引入第二套凭据存储。上一会话做了独立验证：本地 HTTPS+代理实验确认重定向降级拒绝、大小上限、超时与敏感头隔离（`pr12-network-result.json`）；路径判定实验确认 UNC/设备路径在触文件系统前被拒（`pr12-path-result.json`）。两个 Info 级遗留（不必阻塞合并）：`diagnosticErrorText` 在任意 "Stderr:" 字样处截断可能过度删除（方向保守）；`redactSecretAssignments` 在"secret 名的值本身是 flag 形 token"时可能漏掉后面的真实 secret（触发面窄，方向是 backstop）。

   **🟡 必须先修的测试缺陷：** `apps/vscode/test/unit/MarkdownImageResolver.test.ts` 中 `lets a Session on a network share read only from that same share` 和 `still resolves drive and Session-relative paths on Windows` 两组用例使用虚构的 `\\fileserver\...`、`C:\images\a.png` 路径并触发**真实文件系统/网络共享访问**，断言结果必为 `notFound`。在 Windows 实机上可能返回 `readFailed`（上一会话实测失败 1 例）。修复方向：改为注入可 mock 的文件系统边界（`resolveLocalMarkdownImage` 已支持 `platform` 参数，可在 `localFilePath` 层注入），断言"获准进入文件系统的路径恰好调用一次 stat、被拒路径零调用"；保留临时目录的真实文件用例。**不能通过放宽断言或跳过用例来交付。**

4. **组合验证（verified，但有保留）：** 在系统临时目录用 `git archive` + `merge-tree` 生成了 quasi-main×#12×#17 的组合快照，`node scripts/build.mjs --scope all` 与 `check-bundle-size` 通过；#17 全量测试 1126 个用例通过；#12 focused tests 通过但排除了上述 2 个真实路径用例。`webview.css` 余量仅 0.1 KiB（156.3 KiB 预算），后续 CSS 改动大概率触顶，已知问题不阻塞本任务。快照与日志都在 `G:/Enviroment/msys2/tmp/frostpi-pr-candidates-S3LF8c/`（MSYS 临时目录，重启可能丢失；需要时重建）。

5. **0.16.6 发布（verified，已完成）：** `main`/`quasi-main`/`v0.16.6` 同在 `64c7ec2`。期间用户报告了一次 Desktop `spawn EINVAL` 启动失败后自愈，用户决定不追究（"就当已经成功了"）。读者不需要处理它。

## Current Status

- 分支 `quasi-main` @ `64c7ec2`，工作树干净，与远端同步；`origin/main` 同为 `64c7ec2`。
- 版本 0.16.6（已发布）；CHANGELOG 顶部有空的 `[Unreleased]` 段。
- 无未提交文件；无本任务相关的活动 worktree（`.worktrees/release-0.16.6` 是 0.16.6 的发布验证残留，detached @ `64c7ec2`，可按需清理）。
- 临时验证材料：`G:/Enviroment/msys2/tmp/frostpi-pr-candidates-S3LF8c/`（PR diff、组合快照、实验结果）；会话 handover 不依赖它们存活。
- 用户可能正开着 0.16.6 Desktop 与本仓库相关进程；改动/验证注意不要杀掉用户的进程。

## Pending and Next

建议顺序（每步完成后汇报，合并入 `quasi-main` 前需用户确认）：

1. **建立隔离试合分支：** 从 `quasi-main` 切出（例如 `test/upstream-12-17-integration`）。用 `git merge --no-ff` 依次合入 #17 的修复提交 `73b3947`（cherry-pick 或 merge 均可，**不要**带入 `a39b575` 的定版）与 #12 head `0ac4391`。解决两处文档冲突：`CHANGELOG.md`（把上游条目并入 `[Unreleased]`，不要照抄其 `### Security` 分节结构，可保留小节）、`apps/pi-client/src/ui/features/conversation/markdown/markdown.SPEC.md`（冲突在 `updated:` 行附近，正文两侧都保留并理顺）。
2. **修复 #12 的 Windows 路径测试缺陷**（见 Trajectory 第 3 条的修复方向与位置），并补上能在 CI 判定失败的确定性断言。
3. **验证：** `pnpm check` 全绿（包括此前被排除的用例）；对受影响边界跑 focused 测试（remote image loader、Mermaid sanitizer、CSP）。若涉及打包产物或预算余量敏感，跑 `pnpm package:vsix` + `pnpm verify:vsix`；Desktop renderer 有共享改动时按 `dual-maintenance` 判断是否需要 Desktop 构建/烟测。
4. **向用户汇报审查/试合结论**，等待确认后把试合分支 `merge --no-ff` 进 `quasi-main`。之后 0.16.7 的版本/CHANGELOG/发布是独立授权（用户既定计划是"合并 #17 和 #12 然后发版"，但发版动作仍需单独确认）。
5. 顺带事项（不阻塞）：#12 的两个 Info 级发现可记入 `.dev/backlog/` 由用户决定是否后续处理；`webview.css` 预算余量告急同样值得记一笔。

未验证项（读者需要注意）：上游 PR 在"quasi-main 组合"下的**运行时**行为只做过静态/快照级验证；合并后的真实 GUI 或 Extension Host 验收未做，按第 3 步的证据边界决定是否补。
