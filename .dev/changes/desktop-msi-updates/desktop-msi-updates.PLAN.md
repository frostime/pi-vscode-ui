# Desktop MSI updates — execution

目标见 [TARGET-SPEC](desktop-msi-updates.TARGET-SPEC.md)，所有权与主路径见 [SHAPE](desktop-msi-updates.SHAPE.md)。本轮用户要求按“最小实现 + Fail Loud”清理已有实现；此前 Agent 添加的审计、兼容、恢复保证不再构成需求。用户已授权合并到 `quasi-main`，未授权 tag、推送或发布。

## 当前阶段：删减完成，用户已接受合并

本轮清理在 `wip/desktop-msi-updates` 上完成，基于 `dff81b1` 及上轮未提交修改。主 Agent 清理 runtime，打包 worker 清理 MSI 脚本，文档 worker 收敛规范，另一只读 worker 复核主路径。以下区分已实施与尚未完成的验证：

1. 已完成：Runtime 保留 Settings 三操作、完整 Session 门禁、正常保存、原子本地缓存、同 profile 重开与外部输入校验。删除进程扫描、额外包/签名审计、手动恢复和 fallback。
2. 已完成：MSI 打包保留匹配运行资源、官方签名和版本清单。删除 buildRecord、来源/输入哈希、MSI 行政映像审计与其专属验证入口/测试；保留既有 ZIP 合同。
3. 已执行最终源码的 TS/Rust/脚本检查及 JS 构建，结果见下；未运行 GUI smoke。
4. 后续验证（不阻塞本次合并）：下一次 MSI → MSI 升级时观察数据保留、自动重开原 profile 与应用可用。

## 验证状态

- **用户验证：** 已使用 artifacts 中的 MSI 安装，确认程序能运行。此前公开版本只有 ZIP，没有旧版 MSI；用户接受本次合并，不以两版本 MSI 升级为合并前提。内置安装、后续 MSI → MSI 升级及自动重开仍未实测。
- **本轮清理后的验证：** `pnpm --dir apps/desktop test`：23 文件、201 项通过；`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：8 项通过；Desktop lint 通过；Desktop typecheck 为 0 errors、1 条既有 Svelte 警告；`node scripts/build.mjs --scope desktop` 构建通过。未进行本轮 GUI、签名 MSI 重打包或真实安装验收。
- 只读复核发现打包脚本对旧版本残留 MSI 的计数会阻塞下一版本构建；已改为只选择当前 product/version/x64 对应的产物，不删除旧构建目录。
- Windows/UAC 验证使用隔离产品身份/UpgradeCode、安装目录与测试 profile，不对用户正常产品做升级或卸载。若环境不能完成 UAC，准备最小用户辅助步骤并明确标记未验证，不增加替代机制。
- 生产公钥与 signer secrets 由发行者配置；不擅自生成生产身份或发布临时测试包。

## 已接受的限制

Rust updater 未接入 FrostPi Settings 的自定义 Proxy；检查和下载仅沿用底层库的系统／环境代理规则（启用了 `system-proxy`）。用户已知悉并决定先合并，不在本次补实现。

## 不再阻塞完成的事项

污染/篡改包安全承诺、逐文件 hash 与构建来源证明、Key-ID 审计、其他实例扫描/锁、取消后的恢复、自动回滚、多版本保留均不在范围。官方工具自带行为不用修改，也不因此增加验证责任。持久化原子性、外部输入校验、错误明确停止和不破坏用户数据仍是本轮约束。
