const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultState,
  createSession,
  upsertMessage,
} = require("../src/sessionRegistry");
const { buildPromptFromSession } = require("../src/promptCompiler");
const { createSpawnSpec } = require("../src/providers");
const { recordProviderResult, summarizeProviderStatus } = require("../src/providerStatus");
const { renderSessionMarkdown } = require("../src/sessionExport");
const { resolveWritebackTargets } = require("../src/writebackTargets");

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
});

test("upsertMessage appends ordered role content", () => {
  const session = createSession({
    id: "session-1",
    providerId: "codex",
    title: "Fix sync chain",
  });

  upsertMessage(session, { role: "user", content: "first" });
  upsertMessage(session, { role: "assistant", content: "second" });

  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].role, "user");
  assert.equal(session.messages[1].content, "second");
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
  assert.equal(spec.stdin, null);
  assert.match(spec.args.at(-1), /当前输入：summarize/);
});

test("createSpawnSpec builds a hermes oneshot command", () => {
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
  assert.deepEqual(spec.args.slice(0, 2), ["--oneshot", spec.args[1]]);
  assert.match(spec.args[1], /当前输入：check status/);
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
