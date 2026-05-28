const PROVIDER_BLOCK_LABELS = {
  codex: "Codex",
  claude: "Claude",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

function formatTime() {
  return new Date().toISOString().replace("T", " ").slice(0, 16);
}

function trimForSummary(text, max = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function replaceOrAppendMarker(text, marker, bodyLines) {
  const start = `<!-- ${marker}:START -->`;
  const end = `<!-- ${marker}:END -->`;
  const block = [start, ...bodyLines, end].join("\n");
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trim()}\n\n${block}\n`;
}

function renderLatestPageBlock(providerId, session, assistantText) {
  const label = PROVIDER_BLOCK_LABELS[providerId] || providerId;
  return [
    `- 更新时间：${formatTime()}`,
    `- 来源：Agent Chat / ${label}`,
    `- 会话：${session.title}`,
    `- 摘要：${trimForSummary(assistantText)}`,
    session.projectPath ? `- 绑定项目：[[${session.projectPath.replace(/\.md$/, "")}]]` : "- 绑定项目：未绑定",
  ];
}

function renderProjectBlock(providerId, session, assistantText) {
  const label = PROVIDER_BLOCK_LABELS[providerId] || providerId;
  return [
    `- 时间：${formatTime()}`,
    `- 动作：通过 Agent Chat 继续推进 ${label} 会话：${session.title}`,
    `- 结论：${trimForSummary(assistantText)}`,
    `- 下一步：如需继续推进，回到 Agent Chat 中打开该会话继续补充。`,
  ];
}

async function ensureFile(app, filePath, initialText) {
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing) {
    return existing;
  }
  const folder = filePath.split("/").slice(0, -1).join("/");
  if (folder) {
    await app.vault.createFolder(folder).catch(() => {});
  }
  return app.vault.create(filePath, initialText);
}

async function writeBlockToFile(app, filePath, marker, bodyLines, heading) {
  const file = await ensureFile(app, filePath, `# ${heading}\n\n`);
  const original = await app.vault.read(file);
  const next = replaceOrAppendMarker(original, marker, bodyLines);
  await app.vault.modify(file, next);
}

async function writebackSessionResult(app, providerId, session, assistantText, targets) {
  const writes = [];
  const label = PROVIDER_BLOCK_LABELS[providerId] || providerId;

  for (const target of targets) {
    if (target === session.projectPath) {
      writes.push(target);
      await writeBlockToFile(
        app,
        target,
        `AGENT-CHAT:PROJECT:${providerId.toUpperCase()}`,
        renderProjectBlock(providerId, session, assistantText),
        "Agent Chat 项目记录",
      );
      continue;
    }

    writes.push(target);
    await writeBlockToFile(
      app,
      target,
      `AGENT-CHAT:${providerId.toUpperCase()}:LATEST`,
      renderLatestPageBlock(providerId, session, assistantText),
      `${label} Agent Chat 最新记录`,
    );
  }

  return writes;
}

module.exports = {
  writebackSessionResult,
};
