function stripMarkdownExtension(path) {
  return String(path || "").replace(/\.md$/, "");
}

function roleLabel(role) {
  if (role === "user") {
    return "用户";
  }
  if (role === "assistant") {
    return "助手";
  }
  return role || "未知";
}

function renderSessionMarkdown(session, providerLabel) {
  const lines = [];
  const title = session.title || "未命名会话";

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- Agent：${providerLabel || session.providerId || "未知"}`);
  lines.push(`- 会话 ID：${session.id}`);
  lines.push(`- 创建时间：${session.createdAt || ""}`);
  lines.push(`- 更新时间：${session.updatedAt || ""}`);
  if (session.projectPath) {
    lines.push(`- 绑定项目：[[${stripMarkdownExtension(session.projectPath)}]]`);
  } else {
    lines.push("- 绑定项目：未绑定");
  }
  lines.push("");
  lines.push("## 对话记录");
  lines.push("");

  for (const message of session.messages || []) {
    lines.push(`**${roleLabel(message.role)}**：${message.content}`);
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function makeSessionExportPath(session) {
  const date = new Date().toISOString().slice(0, 10);
  const title = String(session.title || "未命名会话")
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || "未命名会话";
  return `AI AGENTS/对话记录/Agent Chat/${date}-${title}.md`;
}

module.exports = {
  makeSessionExportPath,
  renderSessionMarkdown,
};
