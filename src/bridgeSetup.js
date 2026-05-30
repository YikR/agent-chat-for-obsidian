const { DEFAULT_REMOTE_BRIDGE_SETTINGS } = require("./bridgeClient");

const AUTO_BRIDGE_DEFAULT_PORT = 3876;
const DEFAULT_ALLOWED_PROVIDERS = ["codex", "claude", "hermes", "openclaw"];
const BRIDGE_LISTEN_HOST = "0.0.0.0";

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

function isTailscaleIpv4(address) {
  const parts = String(address || "").split(".").map((part) => Number.parseInt(part, 10));
  return parts.length === 4 &&
    parts.every((part) => Number.isFinite(part)) &&
    parts[0] === 100 &&
    parts[1] >= 64 &&
    parts[1] <= 127;
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

function collectIpv4Hosts(networkInterfaces) {
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
  return candidates;
}

function detectLanHost(networkInterfaces) {
  const candidates = collectIpv4Hosts(networkInterfaces)
    .filter((candidate) => !isTailscaleIpv4(candidate.address));
  if (!candidates.length) {
    return "127.0.0.1";
  }
  candidates.sort((left, right) => left.priority - right.priority);
  return candidates[0].address;
}

function detectTailscaleHost(networkInterfaces) {
  const candidates = collectIpv4Hosts(networkInterfaces)
    .filter((candidate) => isTailscaleIpv4(candidate.address));
  if (!candidates.length) {
    return "";
  }
  candidates.sort((left, right) => left.address.localeCompare(right.address));
  return candidates[0].address;
}

function detectRemoteBridgeHost(networkInterfaces, networkMode = "auto") {
  if (networkMode === "lan") {
    return detectLanHost(networkInterfaces);
  }
  const tailscaleHost = detectTailscaleHost(networkInterfaces);
  if (networkMode === "tailscale") {
    return tailscaleHost || detectLanHost(networkInterfaces);
  }
  return tailscaleHost || detectLanHost(networkInterfaces);
}

function detectRemoteBridgeHosts(networkInterfaces, networkMode = "auto") {
  const hosts = [];
  const addHost = (host) => {
    if (host && !hosts.includes(host)) {
      hosts.push(host);
    }
  };
  const lanHost = detectLanHost(networkInterfaces);
  const tailscaleHost = detectTailscaleHost(networkInterfaces);

  if (networkMode === "lan") {
    addHost(lanHost);
    return hosts;
  }
  if (networkMode === "tailscale") {
    addHost(tailscaleHost);
    addHost(lanHost);
    return hosts;
  }
  addHost(tailscaleHost);
  addHost(lanHost);
  return hosts;
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
  hosts,
  port = AUTO_BRIDGE_DEFAULT_PORT,
  token,
  timeoutMs = DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs,
}) {
  const resolvedHosts = Array.isArray(hosts) && hosts.length ? hosts : [host];
  const urls = resolvedHosts.map((candidate) => `http://${candidate}:${port}`);
  return {
    enabled: true,
    url: urls[0],
    urls,
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
  networkMode = "auto",
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
  const hosts = detectRemoteBridgeHosts(interfaces, networkMode);
  const token = generateBridgeToken({ randomBytes });
  const bridgeSettings = buildAutoBridgeSettings({
    hosts,
    port,
    token,
    timeoutMs,
  });
  const bridgeConfig = buildBridgeConfig({
    host: BRIDGE_LISTEN_HOST,
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
  BRIDGE_LISTEN_HOST,
  DEFAULT_ALLOWED_PROVIDERS,
  buildAutoBridgeSettings,
  buildBridgeConfig,
  createAutoBridgeConfig,
  defaultAutoBridgeConfigPath,
  detectLanHost,
  detectRemoteBridgeHost,
  detectRemoteBridgeHosts,
  detectTailscaleHost,
  generateBridgeToken,
  isTailscaleIpv4,
  writeBridgeConfig,
};
