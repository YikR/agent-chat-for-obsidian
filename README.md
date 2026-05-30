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
- 支持手机端 Obsidian 安装和加载
- 手机端默认 Bridge 优先：填写桌面 Mac Bridge URL/token 后可远程执行 Agent
- 手机端未填写 Bridge token 时提供移动工作台模式：查看会话、绑定项目、写回、导出、派单
- 每个会话可绑定 Obsidian 项目页
- 支持会话标题编辑
- 支持手动写回和自动写回
- 支持把当前会话导出为 Markdown 记录
- 显示每个 provider 的最近状态：未检测、运行中、可用、异常、已停用
- 支持一键检测全部 Agent，并把真实调用结果写入状态条
- 检测全部 Agent 后会同步写入 `AI AGENTS/接入状态.md`，让工作台和运行面板看到同一份可用性快照
- 自动为 Obsidian GUI 进程补充常见本地 CLI 路径，避免终端可用但插件找不到命令
- 默认启用你的 Obsidian 专用工作流入口：工作台、任务板、项目主页、最新项目更新、运行面板
- 新会话默认绑定 `02-项目/Obsidian工作流/项目主页.md`
- 支持把当前会话一键派单到 `AI AGENTS/Agent任务板.md`
- 顶部控制区按上下文、工作流入口、会话操作分层显示，适配 Obsidian 侧边栏宽度
- 低频操作收进 `更多` 菜单，减少顶部按钮占用
- 工作流快捷入口默认折叠，需要时展开
- 发送消息后会立即刷新对话区，provider 在后台继续运行
- 助手回复会先显示占位，并在支持 stdout 流的 provider 上增量刷新
- 对话区重绘后自动停留在最新消息，避免每轮回复后跳回顶部
- 自动写回和手动写回进入后台队列，不阻塞对话区最终结果显示
- 支持 provider 原生续接：OpenClaw 固定 `session-key`，Claude 固定 `session-id`，Hermes 固定 `--continue` 会话名
- `检测全部 Agent` 会并行检测，减少等待时间
- 设置页可配置手机端桌面 Bridge 的启用状态、地址、token 和超时
- 设置页可配置每个 provider 的 CLI 路径、工作目录、额外参数、原生续接和启用状态

## 当前边界

这版已经完成插件壳、会话状态、CLI adapter、移动端加载适配、桌面 Bridge 和 Obsidian 写回桥，但每个 provider 的真实可用性仍取决于桌面 Mac 的本机 CLI、模型配置和网络环境。

桌面端默认直接运行本机 `codex / claude / hermes / openclaw` CLI。手机端不能直接 spawn macOS CLI，因此会通过桌面 Bridge 远程执行；如果 Bridge URL/token 未填写，则保留工作台与派单兜底。

### 手机端说明

插件同时适配桌面端和手机端，但两端执行方式不同：

- 桌面端：默认直接运行本机 `codex / claude / hermes / openclaw` CLI。
- 手机端默认 Bridge 优先：插件设置里默认启用手机端远程执行，但不会内置真实 URL/token。
- 手机端未填写 Bridge token：可查看会话、写回、导出、派单到任务板，但不会直接运行本地 CLI。
- 手机端已填写 Bridge URL/token：通过桌面 Mac 的 Agent Chat Bridge 远程执行 agent，然后把回复写入同一个会话。

启动桌面 Bridge：

```bash
mkdir -p ~/.agent-chat-bridge
cat > ~/.agent-chat-bridge/config.json <<'JSON'
{
  "host": "127.0.0.1",
  "port": 3876,
  "token": "replace-with-a-random-token",
  "allowedProviders": ["codex", "claude", "hermes", "openclaw"],
  "defaultCwd": "/Users/yanyunuo"
}
JSON
npm run bridge
```

手机访问时，把 `host` 改成桌面 Mac 的局域网 IP，并在插件设置中填写同样的 URL 和 token。插件默认倾向使用 Bridge，但真实 URL/token 只保存在你的本地插件配置里。不要把 Bridge 暴露到公网；第一版只支持可信局域网使用。

### 原生续接说明

插件默认优先使用 CLI 自带会话能力，减少重复塞入完整历史导致的上下文膨胀：

| Agent | 续接方式 | 说明 |
|---|---|---|
| OpenClaw | `--session-key agent:main:plugin-<session-id>` | 每个插件会话固定一个 OpenClaw 原生 session key |
| Claude | `--session-id <固定 UUID>` | 根据插件会话 ID 生成稳定 UUID |
| Hermes | `--continue agent-chat-<session-id>` | 根据插件会话 ID 生成稳定会话名 |
| Codex | `codex exec resume <sessionId/threadName>` | 仅在会话已有 Codex 原生 id/name 时使用；否则用插件历史 prompt 兜底 |

如果某个 CLI 的原生续接在本机行为异常，可以在设置页关闭该 provider 的“原生续接”，插件会回到历史 prompt 模式。

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
7. 如果状态显示 `未检测`，点击 `检测全部 Agent` 做一次轻量探测
8. 需要进入调度流时，点击 `派单到任务板`

`检测全部 Agent` 会对每个启用的 provider 发起最小调用：`Reply with exactly: OK`。成功会标记为 `可用`，失败会标记为 `异常`，错误原因可通过状态提示查看。

检测结束后，插件会同步更新 `AI AGENTS/接入状态.md` 里的 `Agent Chat 检测状态` 区块。这个页面已经是工作台和运行面板的入口之一，因此检测结果不再只存在插件 UI 内部。

手机端不会运行 `检测全部 Agent`，因为移动端没有本地 CLI 执行环境。

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
