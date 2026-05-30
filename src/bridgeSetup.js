const { DEFAULT_REMOTE_BRIDGE_SETTINGS } = require("./bridgeClient");

const AUTO_BRIDGE_DEFAULT_PORT = 3876;
const DEFAULT_ALLOWED_PROVIDERS = ["codex", "claude", "hermes", "openclaw"];

function requireNode(moduleName) {
  return require(moduleName);
}

function isIpv4(details) {
  return details && (details.family === "IPv4" || details.family === 4);
}

function isPrivateIpv4(address) {
  const parts = String(address || "").split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return false;
  }
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function lanPriority(address) {
  if (/^192\.168\./.test(address)) {
    return 0;
  }
  if (/^10\./.test(address)) {
    return 1;
  }
  if (isPrivateIpv4(address)) {
    return 2;
  }
  return 3;
}

function detectLanHost(networkInterfaces) {
  const candidates = [];
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const details of entries || []) {
      if (!isIpv4(details) || details.internal) {
        continue;
      }
      const address = String(details.address || "").trim();
      if (!address || address === "0.0.0.0") {
        continue;
      }
      candidates.push({
        address,
        priority: lanPriority(address),
      });
    }
  }

  if (!candidates.length) {
    return "127.0.0.1";
  }
  candidates.sort((left, right) => left.priority - right.priority);
  return candidates[0].address;
}

function generateBridgeToken({ randomBytes } = {}) {
  const bytes = (randomBytes || requireNode("node:crypto").randomBytes)(32);
  return Buffer.from(bytes).toString("hex");
}

function defaultAutoBridgeConfigPath(homeDir) {
  const os = requireNode("node:os");
  const path = requireNode("node:path");
  return path.join(homeDir || os.homedir(), ".agent-chat-bridge", "config.json");
}

function buildAutoBridgeSettings({
  host,
  port = AUTO_BRIDGE_DEFAULT_PORT,
  token,
  timeoutMs = DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs,
}) {
  return {
    enabled: true,
    url: `http://${host}:${port}`,
    token,
    timeoutMs,
  };
}

function buildBridgeConfig({
  host,
  port = AUTO_BRIDGE_DEFAULT_PORT,
  token,
  allowedProviders = DEFAULT_ALLOWED_PROVIDERS,
  defaultCwd,
}) {
  return {
    host,
    port,
    token,
    allowedProviders: Array.isArray(allowedProviders) && allowedProviders.length
      ? allowedProviders
      : DEFAULT_ALLOWED_PROVIDERS,
    defaultCwd,
  };
}

function createAutoBridgeConfig({
  networkInterfaces,
  randomBytes,
  homeDir,
  allowedProviders = DEFAULT_ALLOWED_PROVIDERS,
  defaultCwd,
  port = AUTO_BRIDGE_DEFAULT_PORT,
  timeoutMs = DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs,
} = {}) {
  const os = requireNode("node:os");
  const resolvedHomeDir = homeDir || os.homedir();
  const interfaces = networkInterfaces || os.networkInterfaces();
  const host = detectLanHost(interfaces);
  const token = generateBridgeToken({ randomBytes });
  const bridgeSettings = buildAutoBridgeSettings({
    host,
    port,
    token,
    timeoutMs,
  });
  const bridgeConfig = buildBridgeConfig({
    host,
    port,
    token,
    allowedProviders,
    defaultCwd: defaultCwd || resolvedHomeDir,
  });

  return {
    bridgeSettings,
    bridgeConfig,
    configPath: defaultAutoBridgeConfigPath(resolvedHomeDir),
  };
}

function writeBridgeConfig(configPath, config, { fs: fsImpl, path: pathImpl } = {}) {
  const fs = fsImpl || requireNode("node:fs");
  const path = pathImpl || requireNode("node:path");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (typeof fs.chmodSync === "function") {
    fs.chmodSync(configPath, 0o600);
  }
}

module.exports = {
  AUTO_BRIDGE_DEFAULT_PORT,
  DEFAULT_ALLOWED_PROVIDERS,
  buildAutoBridgeSettings,
  buildBridgeConfig,
  createAutoBridgeConfig,
  defaultAutoBridgeConfigPath,
  detectLanHost,
  generateBridgeToken,
  writeBridgeConfig,
};
