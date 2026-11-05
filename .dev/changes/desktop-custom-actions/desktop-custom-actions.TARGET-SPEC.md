# Desktop 自定义 Actions

## 已确认目标

用户希望 Desktop 借用已有外部工具，减少从项目进入日常工作流的步骤，而不是内置另一套 IDE。一个终端 Action 只负责在项目目录打开新的外部终端窗口并运行用户配置的 PowerShell 命令；命令结束后窗口保留。FrostPi 不跟踪输出、运行状态或退出，也不负责关闭、重试和重启。

内置 lazygit 在启动时检测到工具及终端依赖后显示。自定义命令支持 `{{cwd}}`，将其作为当前 shell 安全引用后的路径参数展开。工作目录由后台根据用户点击的 Project 解析，不能由 renderer 提交，也不随 Session worktree 改变。

## 已接受的 UI

- 左侧 Project 菜单只保留 Open In 与 Remove Project。
- 主面板右上角 Project 菜单有 Open In、Actions、Remove Project 三块。Actions 标题右侧齿轮定位到设置；地球、文件夹图标区分全局和项目动作，不再为范围各设一个菜单分组。
- Actions 是现有 Settings 中的独立分类，不能用独立 Action 对话框替换普通 Settings。
- 普通 Settings 保持正常默认分类；菜单齿轮进入 Actions 分类。两种入口的 Actions 编辑器都默认全局，不能隐式选中当前项目。
- 项目编辑必须主动切换到项目范围，再明确选择一个 Project。编辑对象与当前导航项目相互独立。切换分类和范围不丢失未保存编辑。
- 全局动作共用，项目动作追加；没有覆盖、继承或项目自动检测。配置只写 Desktop 用户 settings，不读取或执行仓库中的 Action 配置。
- 设置使用既有 Save、Discard、变更确认和错误处理，不在编辑时执行命令。保存后菜单更新，不重启 Pi。

最新交互原型在 `tmp/desktop-actions-prototype/index.html`，是被 Git 忽略的决策材料，不可作为生产实现导入。

## 验证责任

Agent 验证配置校验/持久化、全局与项目执行隔离、菜单投影不携带命令或目录、`{{cwd}}` 和含空格/引号/分号路径的实际 PowerShell 行为、原生终端启动、设置入口及项目显式选择。终端失败应明确可见，命令及可能含凭据的内容不能进入日志。完成 Desktop 构建和与改动相称的 GUI smoke；已 mock 的原生调用不算真实终端证据。

不实现内嵌终端、任务运行器、HTML/Markdown 内容 Panel、其他 shell 适配或工具安装。VS Code 插件行为不因本功能变化。

## 分支与整合

用户要求先将 main 同步到 quasi-main，再从 quasi-main 新建任务分支。起始核查时二者均为 `3ec12d2`；任务分支为 `feat/desktop-custom-actions`，工作 checkpoint 在 `wip/desktop-custom-actions`。另须审查 `origin/feat/desktop-file-link-routing`（起始审查 commit `5d2d032`），然后将两个功能一起整合到 quasi-main，不进入 main。
