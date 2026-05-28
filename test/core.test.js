const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultState,
  createSession,
  upsertMessage,
} = require("../src/sessionRegistry");
const { buildPromptFromSession } = require("../src/promptCompiler");
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
