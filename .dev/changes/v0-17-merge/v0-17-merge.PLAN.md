# v0.17.0 收敛与验收

[批次入口](README.md)记录已合入的 PR 和移出本版的事项。

## 当前阶段：准备 v0.17.0 发布候选

- 代码基线为本地 `quasi-main @ ba395a2`，已通过 `pnpm check`（1,326 项通过，1 项跳过）。同一基线的 VS Code 1.143.0 扩展宿主测试通过：用受控 Pi 验证新建、停止和关闭标签后停止 Pi。该测试不覆盖窗口重载后恢复历史，也不等于已在真实 Pi 模型环境验收。日志分别在 `tmp/v017-pr34-check.log` 和 `tmp/v017-convergence-vscode-e2e.log`。
- **收尾修复已完成。** `2594ae3` 统一忙时和空闲时 Fork 的重启恢复规则，并在停止 Pi 的确认框说明排队消息会被丢弃；`pnpm check` 通过（1,327 项通过，1 项跳过）。删除和改名维持现状。
- **按最终范围做验收。** 在真实 VS Code 验忙时 Fork 可取消、源会话继续回复，删除已完成的 Fork 不影响源文件，Stop / Restart 不丢历史，`/new` 不继承旧名或旧文件。开启关闭标签联动后，补验重载窗口仍可恢复已保存会话；这不是要求自动重开标签。若本版发布 Desktop，验证保留的共享行为和独立打包门禁。

## 验收后

发布说明已归入 `CHANGELOG.md` 的 `[0.17.0]`。若实际发布日期变化，打 tag 前校对日期。若代码再改，复跑 `pnpm check`；新 worktree 如缺共享构建产物，先运行 `pnpm --filter @frostime/pi-client build`。按 `.dev/docs/release.md` 准备版本化产物；最终合入 `main`、推送、打 tag 和发布另行确认。

[会话短暂倒序](../../known-issues/conversation-turn-order.md) 已记录为暂缓，不重复立项。
