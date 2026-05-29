const STATUS_MARKER = "AGENT-CHAT:PROVIDER-STATUS";

function formatTime(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function trimCell(text, max = 120) {
  const normalized = String(text || "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function statusLabel(status, enabled) {
  if (!enabled) {
    return "已停用";
  }
  if (!status || !status.state) {
    return "未检测";
  }
  if (status.state === "ok") {
    return "可用";
  }
  if (status.state === "running") {
    return "运行中";
  }
  if (status.state === "error") {
    return "异常";
  }
  return "未知";
}

function statusIcon(status, enabled) {
  const label = statusLabel(status, enabled);
  if (label === "可用") {
    return "✅";
  }
  if (label === "运行中") {
    return "⏳";
  }
  if (label === "异常") {
    return "⚠️";
  }
  if (label === "已停用") {
    return "⏸️";
  }
  return "⚪";
}

function renderProviderStatusBlock(providerIds, providers, providerStatus, options = {}) {
  const lines = [
    "## Agent Chat 检测状态",
    "",
    `- 更新时间：${formatTime(options.date)}`,
    "- 来源：Obsidian Agent Chat 插件 / 检测全部 Agent",
    "- 用途：给工作台、运行面板和调度判断提供最近一次本地 Agent 可用性快照。",
    "",
    "| Agent | 状态 | 最近检测 | 说明 |",
    "|---|---|---|---|",
  ];

  for (const providerId of providerIds) {
    const provider = providers[providerId] || {};
    const status = providerStatus[providerId] || {};
    const enabled = provider.enabled !== false;
    const message = status.lastError || status.lastMessage || (enabled ? "尚无检测结果" : "已在插件设置中停用");
    lines.push(
      `| ${provider.label || providerId} | ${statusIcon(status, enabled)} ${statusLabel(status, enabled)} | ${status.checkedAt ? formatTime(new Date(status.checkedAt)) : "-"} | ${trimCell(message)} |`,
    );
  }

  return lines;
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

async function writeProviderStatusToObsidian(app, filePath, providerIds, providers, providerStatus) {
  const file = await ensureFile(app, filePath, "# Agent 接入状态\n\n");
  const original = await app.vault.read(file);
  const block = renderProviderStatusBlock(providerIds, providers, providerStatus);
  const next = replaceOrAppendMarker(original, STATUS_MARKER, block);
  await app.vault.modify(file, next);
  return filePath;
}

module.exports = {
  STATUS_MARKER,
  renderProviderStatusBlock,
  replaceOrAppendMarker,
  statusLabel,
  writeProviderStatusToObsidian,
};
