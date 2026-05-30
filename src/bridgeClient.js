const DEFAULT_REMOTE_BRIDGE_SETTINGS = {
  enabled: true,
  url: "http://127.0.0.1:3876",
  urls: [],
  token: "",
  timeoutMs: 10 * 60 * 1000,
};
const DEFAULT_BRIDGE_HEALTH_TIMEOUT_MS = 10 * 1000;
const BRIDGE_TURN_PROBE_PROVIDER_ID = "__agent_chat_probe__";

function mergeRemoteBridgeSettings(saved = {}) {
  return {
    ...DEFAULT_REMOTE_BRIDGE_SETTINGS,
    ...(saved || {}),
    urls: Array.isArray((saved || {}).urls) ? (saved || {}).urls : [],
  };
}

function hasRemoteBridgeConfig(bridge) {
  return Boolean(
    bridge &&
      bridge.enabled &&
      getBridgeCandidateUrls(bridge).length &&
      String(bridge.token || "").trim(),
  );
}

function normalizeBridgeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getBridgeCandidateUrls(bridge = {}) {
  const seen = new Set();
  const candidates = [bridge.url, ...(
    Array.isArray(bridge.urls) ? bridge.urls : []
  )];
  const urls = [];
  for (const candidate of candidates) {
    const url = normalizeBridgeUrl(candidate);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function buildCandidateError(action, failures) {
  if (failures.length === 1) {
    return failures[0].error;
  }
  const details = failures
    .map((failure) => `${failure.url}: ${failure.error && failure.error.message ? failure.error.message : String(failure.error)}`)
    .join("; ");
  return new Error(`${action} failed for all configured Bridge URLs: ${details}`);
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

  const timeoutMs = Number(bridge.timeoutMs || DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs);
  const payload = buildBridgeTurnPayload(providerId, session, userInput, settings);
  const failures = [];

  for (const url of getBridgeCandidateUrls(bridge)) {
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${url}/v1/turn`, {
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
        selectedUrl: url,
      };
    } catch (error) {
      failures.push({
        url,
        error: error && error.name === "AbortError"
          ? new Error(`Bridge request timed out after ${timeoutMs}ms`)
          : error,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  throw buildCandidateError("Bridge request", failures);
}

async function requestBridgeTurnProbe({
  bridge,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  timeoutMs = DEFAULT_BRIDGE_HEALTH_TIMEOUT_MS,
}) {
  if (!hasRemoteBridgeConfig(bridge)) {
    throw new Error("Remote bridge is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Remote bridge fetch is unavailable in this runtime");
  }

  const payload = {
    providerId: BRIDGE_TURN_PROBE_PROVIDER_ID,
    session: {
      id: "bridge-turn-probe",
      providerId: BRIDGE_TURN_PROBE_PROVIDER_ID,
      title: "Bridge turn probe",
      messages: [],
      nativeSessions: {},
    },
    userInput: "probe",
    settings: {
      providers: {},
    },
  };
  const failures = [];

  for (const url of getBridgeCandidateUrls(bridge)) {
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${url}/v1/turn`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
      const json = await readBridgeJson(response);
      const message = json.error || response.statusText || "Unknown error";
      if (response.status === 403 && /Provider is not allowed/.test(String(message))) {
        return {
          ok: true,
          status: response.status,
          message,
          selectedUrl: url,
        };
      }
      if (!response.ok || json.ok === false) {
        throw new Error(`Bridge turn check failed (${response.status}): ${message}`);
      }
      return {
        ok: true,
        status: response.status,
        message: "Bridge turn check passed",
        selectedUrl: url,
      };
    } catch (error) {
      failures.push({
        url,
        error: error && error.name === "AbortError"
          ? new Error(`Bridge turn check timed out after ${timeoutMs}ms`)
          : error,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  throw buildCandidateError("Bridge turn check", failures);
}

async function requestBridgeHealth({
  bridge,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  timeoutMs = DEFAULT_BRIDGE_HEALTH_TIMEOUT_MS,
}) {
  const urls = getBridgeCandidateUrls(bridge);
  if (!urls.length) {
    throw new Error("Bridge URL is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Remote bridge fetch is unavailable in this runtime");
  }

  const failures = [];
  for (const url of urls) {
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${url}/v1/health`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller ? controller.signal : undefined,
      });
      const json = await readBridgeJson(response);
      if (!response.ok || json.ok === false) {
        throw new Error(`Bridge health check failed (${response.status}): ${json.error || response.statusText || "Unknown error"}`);
      }
      return {
        ok: true,
        name: json.name || "agent-chat-bridge",
        version: json.version || "",
        providers: Array.isArray(json.providers) ? json.providers : [],
        selectedUrl: url,
      };
    } catch (error) {
      failures.push({
        url,
        error: error && error.name === "AbortError"
          ? new Error(`Bridge health check timed out after ${timeoutMs}ms`)
          : error,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  throw buildCandidateError("Bridge health check", failures);
}

module.exports = {
  DEFAULT_BRIDGE_HEALTH_TIMEOUT_MS,
  DEFAULT_REMOTE_BRIDGE_SETTINGS,
  buildBridgeTurnPayload,
  hasRemoteBridgeConfig,
  mergeRemoteBridgeSettings,
  normalizeBridgeUrl,
  getBridgeCandidateUrls,
  requestBridgeHealth,
  requestBridgeTurnProbe,
  requestBridgeTurn,
};
