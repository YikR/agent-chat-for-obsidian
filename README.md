# Agent Chat for Obsidian

一个面向 Obsidian 的统一 Agent 对话插件。它把 `Codex`、`Claude`、`Hermes`、`OpenClaw` 放进同一个持续对话工作台里，并把有价值的结果写回你的 Obsidian 工作流。

GitHub 仓库：`https://github.com/YikR/agent-chat-for-obsidian`

## 适合解决什么问题

很多 Agent CLI 更适合一次性命令，但实际推进项目时，经常需要围绕同一个问题反复追问、切换 Agent、回看上下文、把结论沉淀到 Obsidian。这个插件的目标就是把这些动作收进一个 Obsidian 内部窗口。

当前版本重点服务三个场景：

- 在 Obsidian 里持续和某个 Agent 推进一个问题
- 同一个项目同时开多个 Agent 会话
- 每轮完成后把摘要写回 Obsidian 最新页、最近活动页和绑定项目页

## 当前能力

- `Agent 对话` 视图，可放在右侧边栏使用
- 多 tab、多会话、本地持久化
- 支持 `Codex`、`Claude`、`Hermes`、`OpenClaw` 四个 provider
- 每个会话可绑定 Obsidian 项目页
- 支持会话标题编辑
- 支持手动写回和自动写回
- 支持把当前会话导出为 Markdown 记录
- 显示每个 provider 的最近状态：未检测、运行中、可用、异常、已停用
- 设置页可配置每个 provider 的 CLI 路径、工作目录、额外参数和启用状态

## 当前边界

这版已经完成插件壳、会话状态、CLI adapter 和 Obsidian 写回桥，但每个 provider 的真实可用性仍取决于本机环境。

在当前实现机器上的首轮冒烟结果：

- `Codex`：受本地 app-server 权限初始化阻塞
- `OpenClaw`：受当前环境 DNS/联网限制影响
- `Hermes`：这轮没有形成可用助手返回
- `Claude`：仍需要在真实 Obsidian 运行环境里确认

因此当前结论是：插件已经可安装、可打开、可管理会话；四个 provider 的本机运行链还需要逐个联调。

## 本地安装

插件目录可以直接软链到 Obsidian vault：

```bash
ln -sfn /Users/yanyunuo/agent-chat-for-obsidian \
  '/Users/yanyunuo/Library/Mobile Documents/iCloud~md~obsidian/Documents/.obsidian/plugins/agent-chat-for-obsidian'
```

然后确认 `.obsidian/community-plugins.json` 中包含：

```json
"agent-chat-for-obsidian"
```

回到 Obsidian 后重载社区插件，即可打开 `Agent 对话`。

## 使用方式

1. 打开命令面板，执行 `打开 Agent 对话`
2. 选择 Agent：`Codex`、`Claude`、`Hermes` 或 `OpenClaw`
3. 可选：绑定当前笔记，或手动填写项目页路径
4. 在输入框中继续推进问题
5. 需要沉淀时点击 `写回`
6. 需要完整留档时点击 `导出`

## 写回规则

默认写回目标如下：

| Agent | 最新页 | 最近活动 |
|---|---|---|
| Codex | `AI AGENTS/产出/Codex/最新项目更新.md` | `AI AGENTS/产出/Codex/Codex 最近活动.md` |
| Claude | `AI AGENTS/产出/Claude Code/最新分析摘要.md` | `AI AGENTS/产出/Claude Code/Claude Code 最近活动.md` |
| Hermes | `AI AGENTS/产出/Hermes/最新任务结果.md` | `AI AGENTS/产出/Hermes/Hermes 最近活动.md` |
| OpenClaw | `AI AGENTS/产出/OpenClaw/最新任务产出.md` | `AI AGENTS/产出/OpenClaw/OpenClaw 最近活动.md` |

如果会话绑定了项目页，插件会额外写回该项目页。

## 开发验证

生成 BRAT/Obsidian 发布包：

```bash
npm run build
```

构建产物会写入 `dist/`：

- `dist/main.js`
- `dist/manifest.json`
- `dist/styles.css`

运行核心测试：

```bash
npm test
```

运行语法检查：

```bash
node --check main.js
node --check src/providers.js
node --check src/writeback.js
node --check src/providerStatus.js
node --check src/sessionExport.js
node --check dist/main.js
```

## 安全提醒

不要把 GitHub token、模型 API key、cookie、auth 配置写进 issue、README、普通笔记或聊天记录。如果 token 已经暴露，应立即撤销并重新生成。
