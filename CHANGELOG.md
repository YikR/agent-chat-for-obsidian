# 变更记录

## 0.3.0 - 2026-05-29

- 将插件升级为用户专用 Obsidian 工作流入口。
- 新增工作流快捷入口：工作台、任务板、项目主页、最新项目更新、运行面板。
- 新会话默认绑定 `02-项目/Obsidian工作流/项目主页.md`。
- 新增 `派单到任务板`，可把当前会话写入 `AI AGENTS/Agent任务板.md` 的待派单区。
- 设置页新增专用工作流开关、默认项目页和 Agent任务板路径。

## 0.2.3 - 2026-05-29

- 修复 Obsidian GUI 环境中 `Codex / Claude / Hermes / OpenClaw` 全部显示异常的问题。
- 子进程启动时会自动补充常见本地 CLI 路径，包括 `~/.local/bin`、`~/.local/nodejs-v22.22.2/bin`、`/opt/homebrew/bin` 和 `/usr/local/bin`。

## 0.2.2 - 2026-05-29

- 新增 `检测全部 Agent` 按钮和命令。
- 检测会逐个对启用的 provider 发起轻量调用，并把状态更新为 `运行中 / 可用 / 异常`。
- 新增 provider probe 相关测试。

## 0.2.1 - 2026-05-29

- 修复 BRAT 安装后插件加载失败的问题。
- 新增 `npm run build`，生成不依赖 `src/` 目录的 `dist/main.js` 单文件发布包。
- 测试流程现在会先构建 release bundle，并验证发布包不会在运行时依赖源码文件。

## 0.2.0 - 2026-05-29

- 将仓库 README 改为中文主文档，补充安装、使用、写回规则和安全说明。
- 将插件名称和设置页中的主要操作改为中文表达。
- 增加 provider 状态显示：未检测、运行中、可用、异常、已停用。
- 增加会话标题编辑。
- 增加手动写回当前会话结果。
- 增加会话导出为 Markdown，默认写入 `AI AGENTS/对话记录/Agent Chat/`。
- 补充 provider 状态和会话导出的核心测试。

## 0.1.0 - 2026-05-29

- 创建独立 Obsidian 插件仓库。
- 实现 `Agent Chat` 基础视图、多 tab、本地会话持久化。
- 接入 `Codex`、`Claude`、`Hermes`、`OpenClaw` 的 CLI adapter 骨架。
- 实现写回 Obsidian 最新页、最近活动页和绑定项目页的桥接逻辑。
