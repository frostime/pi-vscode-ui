---
status: locked
---

# 用标签实例标识关闭对应会话

在 VS Code 1.143.0 开启「关闭标签时关闭会话」后，点标签上的 × 会关掉标签，Pi 却继续运行：FrostPi 在面板销毁后读取标题，VS Code 拒绝了这次读取。为每次打开的标签分配独立标识，用它关联 VS Code 的关闭事件和 FrostPi 的会话；标题仍只用于显示。这项改动留在 VS Code 扩展内，不改变共享会话的关闭规则。

## 改动范围

```text
apps/vscode/
├── src/extension/webview-host/
│   └── SessionPanelManager.ts       修改 +35～60 / −25～40  局部重组：分配标签标识，替换标题和时间窗口配对
├── package.json                     修改 +6 / −6           局部调整：六处标签标题栏菜单识别新的 viewType 前缀
└── test/
    ├── unit/SessionPanelManager.test.ts  修改 +45～80 / −15～30  局部重组：验证真实关闭、跨组移动及同名标签的配对
    └── e2e/suite/index.cjs          修改 +15～35 / −0       新增一个真实扩展宿主的关标签回归
```

## 关闭怎么判定

`sessionId` 标识 FrostPi 会话；`panelId` 标识一次打开的编辑器标签。`SessionPanelManager` 创建面板时生成一个不重复的本地编号，将它放进传给 VS Code 的 `viewType`（如 `frostpi.session.17`）。同一会话关掉标签再打开会拿到新编号。FrostPi 只在扩展进程内保存标签到会话的对应关系。VS Code 会按 `viewType` 保存 Webview 来源记录，编号在扩展重新启动后可重新使用，不为每次打开生成全局唯一的 UUID。关闭事件里的 `TabInputWebview.viewType` 在实测宿主带 `mainThreadWebview-` 前缀；标题栏菜单按 `activeWebviewPanelId` 匹配 `frostpi.session.<编号>`。

VS Code 1.143.0 的隔离实验验证了：两个标签可以同名；改名和移动标签组都不会改变各自的 `TabInputWebview.viewType`。实验也观察到，移动标签会让旧组上报一次关闭，但不会销毁面板。因此，收到关闭事件时先检查这个标识是否仍在任一标签组；若还在，就不是最后一次关闭。只有同一个 `panelId` 的最后一个标签关闭、对应面板也已销毁，才向协调器报告一次 `sessionId`。两种事件允许先后到达；只收到销毁事件不关会话。旧面板的事件不能关闭后来重新打开的标签所绑定的会话。

## 保持不变

- `SessionWebviewCoordinator` 继续检查 `frostpi.session.closeWithEditorTab`，默认关闭。开启时走现有「关闭会话」逻辑，保留原来的确认流程，不删除历史文件。
- Registry 已移除会话、扩展自身清理面板时，只清理标签关联，不再发起会话关闭。标签组、标题和两秒时间窗都不作为身份依据；不加共享状态、桥接字段或 Desktop 适配。

## 验收

- **单测：** 两个同名标签只上报实际关闭的那个；关闭与销毁换序不改变结果；销毁后的假面板和真实 VS Code 一样不允许读标题；跨组移动、管理器清理及旧面板事件不关闭仍在使用的会话。
- **真实 VS Code：** 开启选项，点 × 确认对应 Pi 退出；选项关闭时点 ×，会话仍在。再验证改名、跨组移动、重载窗口以及标题栏菜单。现有实验只证明 VS Code 会传回标识；重载与菜单须在实现后验收。
