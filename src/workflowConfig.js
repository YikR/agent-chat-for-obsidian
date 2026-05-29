const WORKFLOW_DEFAULTS = {
  enabled: true,
  defaultProjectPath: "02-项目/Obsidian工作流/项目主页.md",
  taskBoardPath: "AI AGENTS/Agent任务板.md",
  agentStatusPath: "AI AGENTS/接入状态.md",
  quickLinks: [
    { label: "工作台", path: "00-首页/工作台.md" },
    { label: "任务板", path: "AI AGENTS/Agent任务板.md" },
    { label: "项目主页", path: "02-项目/Obsidian工作流/项目主页.md" },
    { label: "最新项目更新", path: "AI AGENTS/产出/Codex/最新项目更新.md" },
    { label: "运行面板", path: "AI AGENTS/运行面板.md" },
  ],
};

const PROVIDER_TASK_META = {
  codex: {
    assignee: "Codex",
    expected: "完成任务，并把结构、页面或代码更新写入最新项目更新。",
    landing: "AI AGENTS/产出/Codex/最新项目更新.md",
  },
  claude: {
    assignee: "Claude Code",
    expected: "完成分析、总结或方案判断，并写入最新分析摘要。",
    landing: "AI AGENTS/产出/Claude Code/最新分析摘要.md",
  },
  hermes: {
    assignee: "Hermes",
    expected: "完成调度、监控或同步检查，并写入最新任务结果。",
    landing: "AI AGENTS/产出/Hermes/最新任务结果.md",
  },
  openclaw: {
    assignee: "OpenClaw",
    expected: "完成投资、定投、日报或行情相关任务，并写入最新任务产出。",
    landing: "AI AGENTS/产出/OpenClaw/最新任务产出.md",
  },
};

function normalizeForTableCell(text) {
  return String(text || "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function wikilink(path) {
  return `[[${String(path || "").replace(/\.md$/, "")}]]`;
}

function getProviderTaskMeta(providerId) {
  return PROVIDER_TASK_META[providerId] || {
    assignee: providerId || "Codex",
    expected: "完成任务，并把结果写回对应最新页。",
    landing: "AI AGENTS/产出/Codex/最新项目更新.md",
  };
}

function formatTaskBoardRow(session) {
  const meta = getProviderTaskMeta(session.providerId);
  const task = normalizeForTableCell(session.title || "继续推进 Agent Chat 会话");
  return `| ${task} | ${meta.assignee} | 待处理 | ${meta.expected} | ${wikilink(meta.landing)} |`;
}

function insertTaskRow(boardText, row) {
  const marker = "\n## 进行中";
  const index = boardText.indexOf(marker);
  if (index === -1) {
    return `${boardText.trim()}\n${row}\n`;
  }
  const before = boardText.slice(0, index).replace(/\s*$/, "");
  const after = boardText.slice(index);
  return `${before}\n${row}\n${after}`;
}

module.exports = {
  WORKFLOW_DEFAULTS,
  formatTaskBoardRow,
  getProviderTaskMeta,
  insertTaskRow,
  wikilink,
};
