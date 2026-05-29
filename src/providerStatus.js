function nowIso() {
  return new Date().toISOString();
}

function recordProviderResult(statusMap, providerId, result) {
  if (!statusMap || !providerId) {
    return statusMap;
  }

  statusMap[providerId] = {
    state: result.ok ? "ok" : "error",
    checkedAt: nowIso(),
    lastMessage: result.ok ? String(result.message || "").trim() : "",
    lastError: result.ok ? "" : String(result.message || "").trim(),
    lastCommand: result.command || "",
  };
  return statusMap;
}

function markProviderRunning(statusMap, providerId, command = "") {
  if (!statusMap || !providerId) {
    return statusMap;
  }

  statusMap[providerId] = {
    ...(statusMap[providerId] || {}),
    state: "running",
    checkedAt: nowIso(),
    lastCommand: command,
  };
  return statusMap;
}

function summarizeProviderStatus(status, enabled) {
  if (!enabled) {
    return "已停用";
  }
  if (!status || !status.state) {
    return "未检测";
  }
  if (status.state === "running") {
    return "运行中";
  }
  if (status.state === "ok") {
    return "可用";
  }
  if (status.state === "error") {
    return "异常";
  }
  return "未知";
}

module.exports = {
  markProviderRunning,
  recordProviderResult,
  summarizeProviderStatus,
};
