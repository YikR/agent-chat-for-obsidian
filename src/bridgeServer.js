const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { runProviderTurn } = require("./providers");

const DEFAULT_BRIDGE_CONFIG = {
  host: "127.0.0.1",
  port: 3876,
  token: "",
  allowedProviders: ["codex", "claude", "hermes", "openclaw"],
  defaultCwd: os.homedir(),
};

function mergeBridgeConfig(saved = {}) {
  return {
    ...DEFAULT_BRIDGE_CONFIG,
    ...(saved || {}),
    allowedProviders: Array.isArray(saved.allowedProviders) && saved.allowedProviders.length
      ? saved.allowedProviders
      : DEFAULT_BRIDGE_CONFIG.allowedProviders,
  };
}

function defaultBridgeConfigPath() {
  return path.join(os.homedir(), ".agent-chat-bridge", "config.json");
}

function loadBridgeConfig(configPath = defaultBridgeConfigPath()) {
  if (!fs.existsSync(configPath)) {
    return mergeBridgeConfig();
  }
  return mergeBridgeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_error) {
        reject(new Error("Invalid JSON request body"));
      }
    });
    req.on("error", reject);
  });
}

function isAuthorized(req, token) {
  if (!token) {
    return false;
  }
  return req.headers.authorization === `Bearer ${token}`;
}

function createBridgeServer({
  config = DEFAULT_BRIDGE_CONFIG,
  providerRunner = runProviderTurn,
} = {}) {
  const resolvedConfig = mergeBridgeConfig(config);

  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/v1/health") {
      writeJson(res, 200, {
        ok: true,
        name: "agent-chat-bridge",
        version: "0.1.0",
        providers: resolvedConfig.allowedProviders,
      });
      return;
    }

    if (req.method !== "POST" || req.url !== "/v1/turn") {
      writeJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (!isAuthorized(req, resolvedConfig.token)) {
      writeJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    try {
      const body = await readBody(req);
      const providerId = String(body.providerId || "");
      if (!providerId) {
        writeJson(res, 400, { ok: false, error: "Missing providerId" });
        return;
      }
      if (!resolvedConfig.allowedProviders.includes(providerId)) {
        writeJson(res, 403, { ok: false, error: `Provider is not allowed: ${providerId}` });
        return;
      }
      const result = await providerRunner(
        providerId,
        body.session || {},
        String(body.userInput || ""),
        body.settings || {},
        { cwd: resolvedConfig.defaultCwd },
      );
      writeJson(res, 200, {
        ok: true,
        assistantText: result.assistantText || "",
        command: result.command || "",
        providerId,
      });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  });
}

module.exports = {
  DEFAULT_BRIDGE_CONFIG,
  createBridgeServer,
  defaultBridgeConfigPath,
  loadBridgeConfig,
  mergeBridgeConfig,
};
