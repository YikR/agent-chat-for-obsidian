function normalizeHistory(messages, maxHistoryMessages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const count = Math.max(0, maxHistoryMessages || 0);
  if (count === 0) {
    return safeMessages;
  }
  return safeMessages.slice(-count);
}

function buildPromptFromSession(session, latestUserInput, options = {}) {
  const history = normalizeHistory(session.messages, options.maxHistoryMessages || 8);
  const lines = [];

  lines.push(`当前会话标题：${session.title || "未命名会话"}`);
  if (session.projectPath) {
    lines.push(`绑定项目：${session.projectPath}`);
  }
  if (history.length) {
    lines.push("最近会话历史：");
    for (const item of history) {
      lines.push(`${item.role}: ${item.content}`);
    }
  }
  lines.push(`当前输入：${latestUserInput}`);

  return lines.join("\n");
}

module.exports = {
  buildPromptFromSession,
};
