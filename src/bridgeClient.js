const DEFAULT_REMOTE_BRIDGE_SETTINGS = {
  enabled: true,
  url: "http://127.0.0.1:3876",
  token: "",
  timeoutMs: 10 * 60 * 1000,
};

function mergeRemoteBridgeSettings(saved = {}) {
  return {
    ...DEFAULT_REMOTE_BRIDGE_SETTINGS,
    ...(saved || {}),
  };
}

function hasRemoteBridgeConfig(bridge) {
  return Boolean(
    bridge &&
      bridge.enabled &&
      String(bridge.url || "").trim() &&
      String(bridge.token || "").trim(),
  );
}

function normalizeBridgeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function buildBridgeTurnPayload(providerId, session, userInput, settings) {
  return {
    providerId,
    session: {
      id: session.id,
      providerId: session.providerId,
      title: session.title,
      projectPath: session.projectPath || "",
      messages: Array.isArray(session.messages) ? session.messages : [],
      nativeSessions: session.nativeSessions || {},
    },
    userInput,
    settings: {
      providers: (settings || {}).providers || {},
    },
  };
}

async function readBridgeJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

async function requestBridgeTurn({
  bridge,
  providerId,
  session,
  userInput,
  settings,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
}) {
  if (!hasRemoteBridgeConfig(bridge)) {
    throw new Error("Remote bridge is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Remote bridge fetch is unavailable in this runtime");
  }

  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  const timeoutMs = Number(bridge.timeoutMs || DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs);
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const payload = buildBridgeTurnPayload(providerId, session, userInput, settings);

  try {
    const response = await fetchImpl(`${normalizeBridgeUrl(bridge.url)}/v1/turn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });
    const json = await readBridgeJson(response);
    if (!response.ok || json.ok === false) {
      throw new Error(`Bridge request failed (${response.status}): ${json.error || response.statusText || "Unknown error"}`);
    }
    return {
      assistantText: json.assistantText || "",
      command: json.command || "",
      providerId: json.providerId || providerId,
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Bridge request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  DEFAULT_REMOTE_BRIDGE_SETTINGS,
  buildBridgeTurnPayload,
  hasRemoteBridgeConfig,
  mergeRemoteBridgeSettings,
  normalizeBridgeUrl,
  requestBridgeTurn,
};
