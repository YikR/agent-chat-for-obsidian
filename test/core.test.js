const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  createDefaultState,
  createSession,
  updateMessageContent,
  upsertMessage,
} = require("../src/sessionRegistry");
const { buildPromptFromSession } = require("../src/promptCompiler");
const { buildExecutionEnv, createProbeSession, createSpawnSpec, resolveNativeSession } = require("../src/providers");
const { recordProviderResult, summarizeProviderStatus } = require("../src/providerStatus");
const { renderSessionMarkdown } = require("../src/sessionExport");
const { resolveWritebackTargets } = require("../src/writebackTargets");
const { writebackSessionResult } = require("../src/writeback");
const { WORKFLOW_DEFAULTS, formatTaskBoardRow, insertTaskRow } = require("../src/workflowConfig");
const { renderProviderStatusBlock, replaceOrAppendMarker, STATUS_MARKER } = require("../src/agentStatusBridge");
const {
  DEFAULT_REMOTE_BRIDGE_SETTINGS,
  buildBridgeTurnPayload,
  hasRemoteBridgeConfig,
  mergeRemoteBridgeSettings,
  requestBridgeTurn,
} = require("../src/bridgeClient");

test("createDefaultState returns a usable empty shell", () => {
  const state = createDefaultState();

  assert.deepEqual(state.tabs, []);
  assert.deepEqual(state.sessions, {});
  assert.equal(state.activeTabId, null);
});

test("createSession seeds provider, title, and writeback structure", () => {
  const session = createSession({
    id: "session-1",
    providerId: "codex",
    title: "Fix sync chain",
    projectPath: "02-项目/Obsidian工作流/项目主页.md",
  });

  assert.equal(session.providerId, "codex");
  assert.equal(session.title, "Fix sync chain");
  assert.equal(session.projectPath, "02-项目/Obsidian工作流/项目主页.md");
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.lastWriteback, []);
  assert.deepEqual(session.nativeSessions, {});
});

test("upsertMessage appends ordered role content", () => {
  const session = createSession({
    id: "session-1",
    providerId: "codex",
    title: "Fix sync chain",
  });

  const first = upsertMessage(session, { role: "user", content: "first" });
  const second = upsertMessage(session, { role: "assistant", content: "second" });

  assert.equal(session.messages.length, 2);
  assert.match(first.id, /^msg-/);
  assert.match(second.id, /^msg-/);
  assert.equal(session.messages[0].role, "user");
  assert.equal(session.messages[1].content, "second");
});

test("updateMessageContent updates an existing assistant placeholder", () => {
  const session = createSession({
    id: "session-1",
    providerId: "codex",
    title: "Streaming",
  });

  const message = upsertMessage(session, { role: "assistant", content: "正在生成…" });
  const updated = updateMessageContent(session, message.id, "partial answer");

  assert.equal(updated.content, "partial answer");
  assert.equal(session.messages[0].content, "partial answer");
  assert.equal(updateMessageContent(session, "missing", "x"), null);
});

test("buildPromptFromSession includes bounded history and current project binding", () => {
  const session = createSession({
    id: "session-1",
    providerId: "hermes",
    title: "Continue plugin task",
    projectPath: "02-项目/Obsidian工作流/项目主页.md",
  });

  upsertMessage(session, { role: "user", content: "question 1" });
  upsertMessage(session, { role: "assistant", content: "answer 1" });
  upsertMessage(session, { role: "user", content: "question 2" });

  const prompt = buildPromptFromSession(session, "next step?", { maxHistoryMessages: 2 });

  assert.match(prompt, /绑定项目：02-项目\/Obsidian工作流\/项目主页\.md/);
  assert.doesNotMatch(prompt, /question 1/);
  assert.match(prompt, /assistant: answer 1/);
  assert.match(prompt, /当前输入：next step\?/);
});

test("resolveWritebackTargets maps providers to latest pages and optional project page", () => {
  const targets = resolveWritebackTargets("openclaw", "02-项目/Obsidian工作流/项目主页.md");

  assert.deepEqual(targets, [
    "AI AGENTS/产出/OpenClaw/最新任务产出.md",
    "AI AGENTS/产出/OpenClaw/OpenClaw 最近活动.md",
    "02-项目/Obsidian工作流/项目主页.md",
  ]);
});

test("writebackSessionResult extracts assistant text before writing JSON summaries", async () => {
  const targetPath = "AI AGENTS/产出/OpenClaw/最新任务产出.md";
  const files = new Map([[targetPath, "# OpenClaw 最新任务产出\n\n"]]);
  const app = {
    vault: {
      getAbstractFileByPath(filePath) {
        return files.has(filePath) ? { path: filePath } : null;
      },
      async createFolder() {},
      async create(filePath, initialText) {
        files.set(filePath, initialText);
        return { path: filePath };
      },
      async read(file) {
        return files.get(file.path);
      },
      async modify(file, nextText) {
        files.set(file.path, nextText);
      },
    },
  };
  const session = createSession({
    id: "session-openclaw-writeback",
    providerId: "openclaw",
    title: "你好",
  });
  const rawJson = JSON.stringify({
    payloads: [
      {
        text: "你好！有什么可以帮你的吗？",
      },
    ],
    meta: {
      provider: "minimax",
    },
  }, null, 2);

  const writes = await writebackSessionResult(app, "openclaw", session, rawJson, [targetPath]);
  const written = files.get(targetPath);

  assert.deepEqual(writes, [targetPath]);
  assert.match(written, /- 摘要：你好！有什么可以帮你的吗？/);
  assert.doesNotMatch(written, /payloads/);
  assert.doesNotMatch(written, /minimax/);
});

test("createSpawnSpec builds a codex exec command with stdin prompt", () => {
  const session = createSession({
    id: "session-codex",
    providerId: "codex",
    title: "Codex thread",
  });

  const spec = createSpawnSpec("codex", session, "continue", {
    providers: {
      codex: {
        cliPath: "codex",
        cwd: "/tmp/codex",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });

  assert.equal(spec.cliPath, "codex");
  assert.deepEqual(spec.args.slice(0, 4), ["exec", "--skip-git-repo-check", "--output-last-message", spec.args[3]]);
  assert.equal(spec.args.at(-1), "-");
  assert.match(spec.stdin, /当前输入：continue/);
});

test("createSpawnSpec can grant Codex danger-full-access explicitly", () => {
  const session = createSession({
    id: "session-codex-full-access",
    providerId: "codex",
    title: "Codex full access",
  });

  const spec = createSpawnSpec("codex", session, "continue", {
    providers: {
      codex: {
        cliPath: "codex",
        cwd: "/Users/yanyunuo",
        timeoutMs: 1000,
        extraArgs: "",
        permissionMode: "danger-full-access",
      },
    },
  });

  assert.equal(spec.cwd, "/Users/yanyunuo");
  assert.deepEqual(spec.args.slice(0, 6), ["exec", "--skip-git-repo-check", "--output-last-message", spec.args[3], "--sandbox", "danger-full-access"]);
});

test("createSpawnSpec can make Codex bypass approvals and sandbox when configured", () => {
  const session = createSession({
    id: "session-codex-bypass",
    providerId: "codex",
    title: "Codex bypass",
  });

  const spec = createSpawnSpec("codex", session, "continue", {
    providers: {
      codex: {
        cliPath: "codex",
        cwd: "/Users/yanyunuo",
        timeoutMs: 1000,
        extraArgs: "",
        permissionMode: "bypass-approvals-and-sandbox",
      },
    },
  });

  assert.ok(spec.args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("mergeRemoteBridgeSettings keeps mobile bridge enabled by default without exposing a token", () => {
  const settings = mergeRemoteBridgeSettings();

  assert.deepEqual(settings, DEFAULT_REMOTE_BRIDGE_SETTINGS);
  assert.equal(settings.enabled, true);
  assert.equal(settings.token, "");
  assert.equal(hasRemoteBridgeConfig(settings), false);
});

test("hasRemoteBridgeConfig requires enabled url and token", () => {
  assert.equal(hasRemoteBridgeConfig({
    enabled: true,
    url: "http://192.168.1.2:3876",
    token: "secret",
    timeoutMs: 1000,
  }), true);
  assert.equal(hasRemoteBridgeConfig({
    enabled: true,
    url: "http://192.168.1.2:3876",
    token: "",
    timeoutMs: 1000,
  }), false);
  assert.equal(hasRemoteBridgeConfig({
    enabled: false,
    url: "http://192.168.1.2:3876",
    token: "secret",
    timeoutMs: 1000,
  }), false);
});

test("buildBridgeTurnPayload sends only provider turn data", () => {
  const session = createSession({
    id: "session-mobile",
    providerId: "codex",
    title: "Mobile run",
    projectPath: "02-项目/Obsidian工作流/项目主页.md",
  });

  const payload = buildBridgeTurnPayload("codex", session, "continue", {
    providers: {
      codex: {
        enabled: true,
        cliPath: "codex",
        cwd: "/Users/yanyunuo",
        timeoutMs: 600000,
        extraArgs: "",
        nativeResume: true,
        permissionMode: "danger-full-access",
      },
    },
    remoteBridge: {
      enabled: true,
      url: "http://192.168.1.2:3876",
      token: "secret",
      timeoutMs: 600000,
    },
  });

  assert.equal(payload.providerId, "codex");
  assert.equal(payload.userInput, "continue");
  assert.equal(payload.session.id, "session-mobile");
  assert.equal(payload.settings.providers.codex.cwd, "/Users/yanyunuo");
  assert.equal(payload.settings.remoteBridge, undefined);
});

test("requestBridgeTurn sends bearer token and parses success", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          assistantText: "OK",
          command: "codex exec -",
          providerId: "codex",
        };
      },
    };
  };

  const result = await requestBridgeTurn({
    bridge: {
      enabled: true,
      url: "http://127.0.0.1:3876/",
      token: "secret",
      timeoutMs: 1000,
    },
    providerId: "codex",
    session: createSession({ id: "session-remote", providerId: "codex", title: "Remote" }),
    userInput: "Reply with exactly: OK",
    settings: { providers: { codex: { enabled: true } } },
    fetchImpl: fakeFetch,
    AbortControllerImpl: AbortController,
  });

  assert.equal(result.assistantText, "OK");
  assert.equal(calls[0].url, "http://127.0.0.1:3876/v1/turn");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
});

test("requestBridgeTurn converts bridge failures into readable errors", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { ok: false, error: "Unauthorized" };
    },
  });

  await assert.rejects(
    () => requestBridgeTurn({
      bridge: {
        enabled: true,
        url: "http://127.0.0.1:3876",
        token: "bad-token",
        timeoutMs: 1000,
      },
      providerId: "codex",
      session: createSession({ id: "session-remote-fail", providerId: "codex", title: "Remote" }),
      userInput: "run",
      settings: { providers: { codex: { enabled: true } } },
      fetchImpl: fakeFetch,
      AbortControllerImpl: AbortController,
    }),
    /Bridge request failed \(401\): Unauthorized/,
  );
});

test("createSpawnSpec builds a claude print command", () => {
  const session = createSession({
    id: "session-claude",
    providerId: "claude",
    title: "Claude thread",
  });

  const spec = createSpawnSpec("claude", session, "summarize", {
    providers: {
      claude: {
        cliPath: "claude",
        cwd: "/tmp/claude",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });

  assert.equal(spec.cliPath, "claude");
  assert.deepEqual(spec.args.slice(0, 3), ["-p", "--output-format", "text"]);
  assert.ok(spec.args.includes("--session-id"));
  assert.equal(spec.stdin, null);
  assert.match(spec.args.at(-1), /当前输入：summarize/);
});

test("createSpawnSpec builds a hermes native continuation oneshot command", () => {
  const session = createSession({
    id: "session-hermes",
    providerId: "hermes",
    title: "Hermes thread",
  });

  const spec = createSpawnSpec("hermes", session, "check status", {
    providers: {
      hermes: {
        cliPath: "hermes",
        cwd: "/tmp/hermes",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });

  assert.equal(spec.cliPath, "hermes");
  assert.deepEqual(spec.args.slice(0, 4), ["--continue", "agent-chat-session-hermes", "--oneshot", spec.args[3]]);
  assert.match(spec.args[3], /当前输入：check status/);
});

test("createSpawnSpec builds an openclaw local agent command", () => {
  const session = createSession({
    id: "session-openclaw",
    providerId: "openclaw",
    title: "OpenClaw thread",
  });

  const spec = createSpawnSpec("openclaw", session, "plan next move", {
    providers: {
      openclaw: {
        cliPath: "openclaw",
        cwd: "/tmp/openclaw",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });

  assert.equal(spec.cliPath, "openclaw");
  assert.deepEqual(spec.args.slice(0, 4), ["agent", "--local", "--json", "--session-key"]);
  assert.equal(spec.args[4], "agent:main:plugin-session-openclaw");
  assert.match(spec.args.at(-1), /当前输入：plan next move/);
});

test("openclaw output parser extracts payload text from json result", () => {
  const session = createSession({
    id: "session-openclaw-json",
    providerId: "openclaw",
    title: "OpenClaw thread",
  });
  const spec = createSpawnSpec("openclaw", session, "probe", {
    providers: {
      openclaw: {
        cliPath: "openclaw",
        cwd: "/tmp/openclaw",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });
  const raw = JSON.stringify({
    payloads: [
      {
        text: "OKOK",
      },
    ],
    meta: {
      provider: "minimax",
    },
  });

  assert.equal(spec.outputParser(raw), "OKOK");
});

test("createSpawnSpec can disable native resume and include bounded history", () => {
  const session = createSession({
    id: "session-claude-no-native",
    providerId: "claude",
    title: "Claude thread",
  });
  upsertMessage(session, { role: "user", content: "previous question" });

  const spec = createSpawnSpec("claude", session, "summarize", {
    providers: {
      claude: {
        cliPath: "claude",
        cwd: "/tmp/claude",
        timeoutMs: 1000,
        extraArgs: "",
        nativeResume: false,
      },
    },
  });

  assert.equal(spec.args.includes("--session-id"), false);
  assert.match(spec.args.at(-1), /previous question/);
});

test("resolveNativeSession creates stable provider native ids", () => {
  const session = createSession({
    id: "session-native",
    providerId: "openclaw",
    title: "Native",
  });

  assert.match(resolveNativeSession("claude", session).sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(resolveNativeSession("hermes", session).sessionName, "agent-chat-session-native");
  assert.equal(resolveNativeSession("openclaw", session).sessionKey, "agent:main:plugin-session-native");
});

test("createProbeSession returns a stable lightweight probe session", () => {
  const session = createProbeSession("hermes");

  assert.equal(session.id, "probe-hermes");
  assert.equal(session.providerId, "hermes");
  assert.equal(session.title, "Agent 可用性检测");
  assert.deepEqual(session.messages, []);
});

test("createSpawnSpec can build a lightweight provider probe", () => {
  const session = createProbeSession("codex");
  const spec = createSpawnSpec("codex", session, "Reply with exactly: OK", {
    providers: {
      codex: {
        cliPath: "codex",
        cwd: "/tmp/codex",
        timeoutMs: 1000,
        extraArgs: "",
      },
    },
  });

  assert.match(spec.stdin, /当前会话标题：Agent 可用性检测/);
  assert.match(spec.stdin, /当前输入：Reply with exactly: OK/);
});

test("buildExecutionEnv extends GUI PATH with local agent command directories", () => {
  const env = buildExecutionEnv({
    HOME: "/Users/example",
    PATH: "/usr/bin:/bin",
  });

  assert.match(env.PATH, /\/Users\/example\/\.local\/bin/);
  assert.match(env.PATH, /\/Users\/example\/\.local\/nodejs-v22\.22\.2\/bin/);
  assert.match(env.PATH, /\/opt\/homebrew\/bin/);
  assert.match(env.PATH, /\/usr\/local\/bin/);
  assert.match(env.PATH, /\/usr\/bin:\/bin/);
});

test("recordProviderResult stores success and failure status by provider", () => {
  const status = {};

  recordProviderResult(status, "codex", {
    ok: true,
    message: "OK",
    command: "codex exec",
  });
  recordProviderResult(status, "openclaw", {
    ok: false,
    message: "network error",
    command: "openclaw agent",
  });

  assert.equal(status.codex.state, "ok");
  assert.equal(status.codex.lastMessage, "OK");
  assert.equal(status.openclaw.state, "error");
  assert.equal(status.openclaw.lastError, "network error");
  assert.equal(status.openclaw.lastCommand, "openclaw agent");
});

test("summarizeProviderStatus returns Chinese display text", () => {
  assert.equal(summarizeProviderStatus(undefined, true), "未检测");
  assert.equal(summarizeProviderStatus(undefined, false), "已停用");
  assert.equal(summarizeProviderStatus({ state: "running" }, true), "运行中");
  assert.equal(summarizeProviderStatus({ state: "ok" }, true), "可用");
  assert.equal(summarizeProviderStatus({ state: "error" }, true), "异常");
});

test("renderSessionMarkdown exports a readable Chinese transcript", () => {
  const session = createSession({
    id: "session-export",
    providerId: "claude",
    title: "整理插件说明",
    projectPath: "02-项目/Obsidian工作流/项目主页.md",
  });
  upsertMessage(session, { role: "user", content: "先列结构" });
  upsertMessage(session, { role: "assistant", content: "可以分成三层。" });

  const markdown = renderSessionMarkdown(session, "Claude");

  assert.match(markdown, /^# 整理插件说明/);
  assert.match(markdown, /- Agent：Claude/);
  assert.match(markdown, /- 绑定项目：\[\[02-项目\/Obsidian工作流\/项目主页\]\]/);
  assert.match(markdown, /## 对话记录/);
  assert.match(markdown, /\*\*用户\*\*：先列结构/);
  assert.match(markdown, /\*\*助手\*\*：可以分成三层。/);
});

test("release bundle does not depend on source files at runtime", () => {
  const bundle = fs.readFileSync("dist/main.js", "utf8");

  assert.doesNotMatch(bundle, /require\(["']\.\/src\//);
  assert.match(bundle, /__agentChatRequire/);
});

test("provider module does not import desktop-only Node APIs at module load", () => {
  const source = fs.readFileSync("src/providers.js", "utf8");
  const topLevel = source.slice(0, source.indexOf("const { buildPromptFromSession }"));

  assert.doesNotMatch(topLevel, /node:child_process/);
  assert.doesNotMatch(topLevel, /node:fs/);
  assert.doesNotMatch(topLevel, /node:os/);
  assert.doesNotMatch(topLevel, /node:path/);
});

test("manifest allows mobile Obsidian installation", () => {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

  assert.equal(manifest.isDesktopOnly, false);
});

test("chat view renders assistant messages with Obsidian MarkdownRenderer", () => {
  const source = fs.readFileSync("main.js", "utf8");

  assert.match(source, /MarkdownRenderer/);
  assert.match(source, /MarkdownRenderer\.renderMarkdown/);
  assert.doesNotMatch(source, /messageEl\.createDiv\(\{\s*cls:\s*"agent-chat-message-body",\s*text:\s*message\.content\s*\}\);/);
});

test("activateView reuses an existing Agent Chat leaf before creating one", () => {
  const source = fs.readFileSync("main.js", "utf8");
  const activateView = source.match(/async activateView\(\) \{[\s\S]*?\n  \}/);

  assert.ok(activateView, "activateView function should exist");
  assert.match(activateView[0], /getLeavesOfType\(VIEW_TYPE_AGENT_CHAT\)/);
  assert.ok(
    activateView[0].indexOf("getLeavesOfType(VIEW_TYPE_AGENT_CHAT)") < activateView[0].indexOf("getRightLeaf"),
    "activateView should inspect existing Agent Chat leaves before creating a new leaf",
  );
});

test("workflow defaults point at the user's Obsidian workflow pages", () => {
  assert.equal(WORKFLOW_DEFAULTS.enabled, true);
  assert.equal(WORKFLOW_DEFAULTS.defaultProjectPath, "02-项目/Obsidian工作流/项目主页.md");
  assert.equal(WORKFLOW_DEFAULTS.taskBoardPath, "AI AGENTS/Agent任务板.md");
  assert.equal(WORKFLOW_DEFAULTS.agentStatusPath, "AI AGENTS/接入状态.md");
  assert.ok(WORKFLOW_DEFAULTS.quickLinks.some((link) => link.label === "任务板"));
});

test("settings UI exposes a dedicated Codex permission mode selector", () => {
  const source = fs.readFileSync("main.js", "utf8");

  assert.match(source, /Codex 权限模式/);
  assert.match(source, /permissionMode/);
  assert.match(source, /bypass-approvals-and-sandbox/);
});

test("renderProviderStatusBlock creates a workflow-readable status table", () => {
  const lines = renderProviderStatusBlock(
    ["codex", "claude"],
    {
      codex: { label: "Codex", enabled: true },
      claude: { label: "Claude", enabled: true },
    },
    {
      codex: {
        state: "ok",
        checkedAt: "2026-05-29T07:10:00.000Z",
        lastMessage: "OK",
      },
      claude: {
        state: "error",
        checkedAt: "2026-05-29T07:11:00.000Z",
        lastError: "timeout",
      },
    },
    { date: new Date("2026-05-29T07:12:00.000Z") },
  );

  const markdown = lines.join("\n");
  assert.match(markdown, /## Agent Chat 检测状态/);
  assert.match(markdown, /\| Codex \| ✅ 可用 \| 2026-05-29 07:10 \| OK \|/);
  assert.match(markdown, /\| Claude \| ⚠️ 异常 \| 2026-05-29 07:11 \| timeout \|/);
});

test("replaceOrAppendMarker updates the Agent Chat provider status block", () => {
  const original = "# Agent 接入状态\n\n旧内容\n";
  const next = replaceOrAppendMarker(original, STATUS_MARKER, ["## Agent Chat 检测状态", "", "- 更新时间：x"]);
  const updated = replaceOrAppendMarker(next, STATUS_MARKER, ["## Agent Chat 检测状态", "", "- 更新时间：y"]);

  assert.match(next, /<!-- AGENT-CHAT:PROVIDER-STATUS:START -->/);
  assert.match(updated, /- 更新时间：y/);
  assert.doesNotMatch(updated, /- 更新时间：x/);
});

test("formatTaskBoardRow creates a dispatchable Agent task row", () => {
  const session = createSession({
    id: "session-task",
    providerId: "claude",
    title: "分析这个插件下一步怎么完善 | 避免断链",
  });

  const row = formatTaskBoardRow(session);

  assert.equal(
    row,
    "| 分析这个插件下一步怎么完善 / 避免断链 | Claude Code | 待处理 | 完成分析、总结或方案判断，并写入最新分析摘要。 | [[AI AGENTS/产出/Claude Code/最新分析摘要]] |",
  );
});

test("insertTaskRow adds new tasks before the in-progress section", () => {
  const board = "## 待派单\n\n| 任务 | 指派给 | 状态 | 期望产出 | 落地位置 |\n|---|---|---|---|---|\n\n## 进行中\n\n（暂无）\n";
  const next = insertTaskRow(board, "| 新任务 | Codex | 待处理 | 完成 | [[AI AGENTS/产出/Codex/最新项目更新]] |");

  assert.match(next, /\| 新任务 \| Codex \| 待处理 \| 完成 \| \[\[AI AGENTS\/产出\/Codex\/最新项目更新\]\] \|\n\n## 进行中/);
});
