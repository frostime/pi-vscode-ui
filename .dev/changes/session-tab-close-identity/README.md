# 修复 VS Code 会话标签的关闭判定

- **状态：** 修复已实现，未合入。
- **验证：** VS Code 1.143.0 的扩展宿主回归通过。隔离窗口实测：跨组移动不会结束会话；开启联动后点 × 会结束 Pi，关闭联动时不会；标题栏的 FrostPi 新建按钮可见。窗口重载尚未实测。
- **创建 / 更新：** 2026-11-22
- **基线：** `quasi-main @ 75b1e75`，已包含 #13。
- 按 `change-based-development` 管理。入口：[SHAPE](session-tab-close-identity.SHAPE.md)。
