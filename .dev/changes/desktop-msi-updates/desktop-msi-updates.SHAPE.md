---
status: active
title: Desktop MSI 更新 — 最小代码边界
updated: 2026-11-03
---

# Desktop MSI 更新 — SHAPE

目标以 [TARGET-SPEC](desktop-msi-updates.TARGET-SPEC.md) 为准，验证状态见 [PLAN](desktop-msi-updates.PLAN.md)。本页描述收敛后的实现边界，不宣称并行清理已完成。

## 所有者

| 范围（相对 `apps/desktop/`） | 责任 |
|---|---|
| `src/renderer/UpdateSection.svelte`、`SettingsPanel.svelte`、`DesktopApp.svelte` | Settings 内独立更新操作；保留设置草稿和现有安装退出确认 |
| `src/shared/desktopUpdates.ts` 与现有 application bridge | 有限更新动作、输入校验、状态投影；远端 available 与本地 downloaded 分开 |
| `src/main/createDesktopBackend.ts`、`DesktopActionDispatcher.ts` | 全 Project Session 与未完成 New/Resume 门禁；安装获准后关闭 Session 准入 |
| `src/main/backend.ts`、`src-tauri/src/main.rs` | 私有安装准备请求；复用正常保存/退出顺序，等待 drain 成功 |
| `src-tauri/src/updates/` | 官方 updater 的检查、下载、本地恢复与安装；一份本地下载的原子持久化 |
| `src-tauri/src/main.rs`、`updates/installation.rs` | 绝对 profile 启动约束、同 profile 自动重开参数；不扫描其他进程 |
| `scripts/package-msi.mjs`、`msi-contract.mjs`、`prepare-msi-release.mjs` | MSI 构建、官方签名、必要发布输入检查和版本清单，不做构建审计 |
| `src-tauri/tauri.conf.json`、根脚本、`.github/workflows/desktop.yml` | 全用户 MSI、更新 endpoint、公钥配置；保留 ZIP，MSI/签名先于清单发布 |

共享 ClientApp、SessionRegistry、Pi RPC 不新增更新职责。renderer 不调用 updater 插件命令，仍经有限 Node 路由。

## 主路径

```text
Settings → read/check/download/install
  → finite application bridge → Node → Rust updater

install
  → 恢复本地版本信息并读取已下载 MSI（不请求 latest）
  → Node 最终检查完整 Session 集合与未完成 New/Resume
  → 同步关闭 Session 准入
  → 既有 metadata drain，等待成功确认
  → 官方 updater install(本地 bytes)
  → MSI 全用户安装/UAC → 自动重开原绝对 profile
```

正常 Exit 的忙碌确认与更新的“无任何打开 Session”是不同策略。门禁属于 Desktop，不改变共享 Registry 或 agent turn 调度。安装器必须从 Rust 启动，避免 Node 的 kill-on-close Job 将它终止。

## 持久化与错误

本地缓存选择 `%LOCALAPPDATA%/FrostPi/updates/<profile-key>/`，只保留一个可安装版本及必要元数据，不建立多版本仓库。安装包和完成指针原子提交，不把半成品显示为完成下载。原子落盘不扩展为“替换失败必须保住旧包”的恢复协议。

网络、文件、用户输入及子进程数据在入口校验；内部调用方可信。读取更新状态不触发网络请求，也不增加整包审计。缺文件、格式错误、保存或启动失败均明确失败；不删除损坏状态后继续运行，不恢复 Session 准入来假装更新未发生，不重试、不回滚、不提供 fallback。官方工具附带的校验行为保持，不叠加手动 verify、Key-ID、签名注释或文件头检查。

启动时在打开 profile/启动 Node 前拒绝相对路径。安装重开传递当前绝对 profile，参数按 Windows/MSI 调用约定引用，不猜工作目录或回退默认 profile。

## 交付与删减

普通 Desktop/ZIP 构建不需要签名私钥，未配置发行公钥时更新功能不可用。MSI 路径沿用官方 signer 所需配置，私钥不进应用、profile、日志或编译子进程。发布只需要 MSI、签名、版本清单；不新增 MSI checksum 账本、`.msi.build.json`、源码/输入哈希、行政映像逐文件核对或专属证明报告。既有 ZIP 的独立契约不在本轮重构范围。

删除其他实例扫描、跨 profile 锁、取消恢复协议及其专属测试/规范。不主动停止其他实例，也不承担跨实例协调；用户应先关闭其他实例。不要以未验证的 MSI 行为替代被取消的保证。

## 验证边界

保留与核心合同相称的 Session 门禁、Settings、原子缓存及发布输入测试；删除仅服务于已取消审计/恢复责任的测试。最终执行结果由主 Agent 记录，不沿用旧数量或旧通过状态。

用户已验证 artifacts 中的 MSI 可安装且程序能运行，并接受合并。此前发行版只有 ZIP；后续 MSI → MSI 升级、内置安装及自动重开仍未实测，不阻塞本次合并。取消/失败恢复、污染包和构建证明不列为验收门槛。
