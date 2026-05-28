const PROVIDER_TARGETS = {
  codex: [
    "AI AGENTS/产出/Codex/最新项目更新.md",
    "AI AGENTS/产出/Codex/Codex 最近活动.md",
  ],
  claude: [
    "AI AGENTS/产出/Claude Code/最新分析摘要.md",
    "AI AGENTS/产出/Claude Code/Claude Code 最近活动.md",
  ],
  hermes: [
    "AI AGENTS/产出/Hermes/最新任务结果.md",
    "AI AGENTS/产出/Hermes/Hermes 最近活动.md",
  ],
  openclaw: [
    "AI AGENTS/产出/OpenClaw/最新任务产出.md",
    "AI AGENTS/产出/OpenClaw/OpenClaw 最近活动.md",
  ],
};

function resolveWritebackTargets(providerId, projectPath = "") {
  const base = PROVIDER_TARGETS[providerId] ? [...PROVIDER_TARGETS[providerId]] : [];
  if (projectPath) {
    base.push(projectPath);
  }
  return base;
}

module.exports = {
  resolveWritebackTargets,
};
