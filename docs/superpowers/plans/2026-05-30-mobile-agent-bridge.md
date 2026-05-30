# Mobile Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Chat work on both desktop and mobile by keeping desktop local CLI execution as the default and making mobile Bridge-preferred by default for this personal workflow.

**Architecture:** Add a small HTTP bridge server for the desktop Mac, a fetch-based bridge client for Obsidian mobile, and a transport selector that chooses local CLI on desktop, remote bridge on configured mobile, or the current mobile workbench fallback when the default Bridge setting still lacks a local token. Keep provider adapters in `src/providers.js` as the single local execution path so Codex, Claude, Hermes, and OpenClaw behavior remains consistent.

**Tech Stack:** Obsidian plugin API, CommonJS JavaScript, Node built-ins (`http`, `fs`, `path`, `os`, `child_process`), `fetch` / `AbortController`, Node `node:test`

---

## File Structure

- Create `src/bridgeClient.js`: pure client helpers for remote bridge settings, request payloads, fetch execution, and readable errors.
- Create `src/bridgeServer.js`: pure HTTP server helpers with injectable provider runner for tests and default runner for the CLI script.
- Create `src/turnTransport.js`: runtime transport selector used by `main.js` and unit-tested without loading Obsidian.
- Create `scripts/agent-chat-bridge.js`: manual desktop bridge entrypoint.
- Modify `main.js`: add settings UI, mobile banner text, and use `runTurnForRuntime(...)` for desktop/mobile sending.
- Modify `scripts/build.js`: bundle `src/bridgeClient.js` and `src/turnTransport.js` into `dist/main.js`.
- Modify `test/core.test.js`: add red-green tests for bridge client, bridge server, and dual-mode routing.
- Modify `README.md`: document desktop mode, mobile mode, bridge start, LAN URL, token, and safety limits.
- Modify `CHANGELOG.md`, `package.json`, and `manifest.json`: bump to `0.7.0`.

---

### Task 1: Bridge Client Settings and Requests

**Files:**
- Create: `/Users/yanyunuo/agent-chat-for-obsidian/src/bridgeClient.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/test/core.test.js`

- [ ] **Step 1: Write failing bridge client tests**

Add this import near the top of `test/core.test.js`:

```js
const {
  DEFAULT_REMOTE_BRIDGE_SETTINGS,
  buildBridgeTurnPayload,
  hasRemoteBridgeConfig,
  mergeRemoteBridgeSettings,
  requestBridgeTurn,
} = require("../src/bridgeClient");
```

Add these tests after the existing provider spawn spec tests:

```js
test("mergeRemoteBridgeSettings keeps mobile bridge enabled by default without exposing a token", () => {
  const settings = mergeRemoteBridgeSettings();

  assert.deepEqual(settings, DEFAULT_REMOTE_BRIDGE_SETTINGS);
  assert.equal(settings.enabled, true);
  assert.equal(settings.token, "");
  assert.equal(hasRemoteBridgeConfig(settings), false);
});

test("hasRemoteBridgeConfig requires enabled url and token", () => {
  assert.equal(hasRemoteBridgeConfig({
    enabled: true,
    url: "http://192.168.1.2:3876",
    token: "secret",
    timeoutMs: 1000,
  }), true);
  assert.equal(hasRemoteBridgeConfig({
    enabled: true,
    url: "http://192.168.1.2:3876",
    token: "",
    timeoutMs: 1000,
  }), false);
  assert.equal(hasRemoteBridgeConfig({
    enabled: false,
    url: "http://192.168.1.2:3876",
    token: "secret",
    timeoutMs: 1000,
  }), false);
});

test("buildBridgeTurnPayload sends only provider turn data", () => {
  const session = createSession({
    id: "session-mobile",
    providerId: "codex",
    title: "Mobile run",
    projectPath: "02-项目/Obsidian工作流/项目主页.md",
  });

  const payload = buildBridgeTurnPayload("codex", session, "continue", {
    providers: {
      codex: {
        enabled: true,
        cliPath: "codex",
        cwd: "/Users/yanyunuo",
        timeoutMs: 600000,
        extraArgs: "",
        nativeResume: true,
        permissionMode: "danger-full-access",
      },
    },
    remoteBridge: {
      enabled: true,
      url: "http://192.168.1.2:3876",
      token: "secret",
      timeoutMs: 600000,
    },
  });

  assert.equal(payload.providerId, "codex");
  assert.equal(payload.userInput, "continue");
  assert.equal(payload.session.id, "session-mobile");
  assert.equal(payload.settings.providers.codex.cwd, "/Users/yanyunuo");
  assert.equal(payload.settings.remoteBridge, undefined);
});

test("requestBridgeTurn sends bearer token and parses success", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          assistantText: "OK",
          command: "codex exec -",
          providerId: "codex",
        };
      },
    };
  };

  const result = await requestBridgeTurn({
    bridge: {
      enabled: true,
      url: "http://127.0.0.1:3876/",
      token: "secret",
      timeoutMs: 1000,
    },
    providerId: "codex",
    session: createSession({ id: "session-remote", providerId: "codex", title: "Remote" }),
    userInput: "Reply with exactly: OK",
    settings: { providers: { codex: { enabled: true } } },
    fetchImpl: fakeFetch,
    AbortControllerImpl: AbortController,
  });

  assert.equal(result.assistantText, "OK");
  assert.equal(calls[0].url, "http://127.0.0.1:3876/v1/turn");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
});

test("requestBridgeTurn converts bridge failures into readable errors", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { ok: false, error: "Unauthorized" };
    },
  });

  await assert.rejects(
    () => requestBridgeTurn({
      bridge: {
        enabled: true,
        url: "http://127.0.0.1:3876",
        token: "bad-token",
        timeoutMs: 1000,
      },
      providerId: "codex",
      session: createSession({ id: "session-remote-fail", providerId: "codex", title: "Remote" }),
      userInput: "run",
      settings: { providers: { codex: { enabled: true } } },
      fetchImpl: fakeFetch,
      AbortControllerImpl: AbortController,
    }),
    /Bridge request failed \(401\): Unauthorized/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `Cannot find module '../src/bridgeClient'`.

- [ ] **Step 3: Implement `src/bridgeClient.js`**

Create `/Users/yanyunuo/agent-chat-for-obsidian/src/bridgeClient.js` with:

```js
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
    String(bridge.token || "").trim()
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
```

- [ ] **Step 4: Run tests to verify client passes**

Run:

```bash
npm test
```

Expected: existing tests plus new bridge client tests pass, unless later tasks have already added failing tests.

- [ ] **Step 5: Commit client changes**

Run:

```bash
git add src/bridgeClient.js test/core.test.js
git commit -m "feat: add mobile bridge client"
```

Expected: commit succeeds.

---

### Task 2: Desktop Bridge Server and Manual Start Script

**Files:**
- Create: `/Users/yanyunuo/agent-chat-for-obsidian/src/bridgeServer.js`
- Create: `/Users/yanyunuo/agent-chat-for-obsidian/scripts/agent-chat-bridge.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/test/core.test.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/package.json`

- [ ] **Step 1: Write failing bridge server tests**

Add this import to `test/core.test.js`:

```js
const { createBridgeServer, DEFAULT_BRIDGE_CONFIG } = require("../src/bridgeServer");
```

Add these helpers near the bridge tests:

```js
function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
```

Add these tests:

```js
test("createBridgeServer exposes health with configured providers", async () => {
  const server = createBridgeServer({
    config: {
      ...DEFAULT_BRIDGE_CONFIG,
      token: "secret",
      allowedProviders: ["codex", "openclaw"],
    },
    providerRunner: async () => ({ assistantText: "unused", command: "unused" }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/v1/health`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.providers, ["codex", "openclaw"]);
  } finally {
    await closeServer(server);
  }
});

test("bridge server rejects turn requests without token", async () => {
  const server = createBridgeServer({
    config: {
      ...DEFAULT_BRIDGE_CONFIG,
      token: "secret",
      allowedProviders: ["codex"],
    },
    providerRunner: async () => ({ assistantText: "unused", command: "unused" }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "codex",
        session: createSession({ id: "session-server", providerId: "codex", title: "Server" }),
        userInput: "run",
        settings: { providers: { codex: { enabled: true } } },
      }),
    });
    const json = await response.json();

    assert.equal(response.status, 401);
    assert.equal(json.ok, false);
    assert.equal(json.error, "Unauthorized");
  } finally {
    await closeServer(server);
  }
});

test("bridge server rejects providers outside allowlist", async () => {
  const server = createBridgeServer({
    config: {
      ...DEFAULT_BRIDGE_CONFIG,
      token: "secret",
      allowedProviders: ["codex"],
    },
    providerRunner: async () => ({ assistantText: "unused", command: "unused" }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "openclaw",
        session: createSession({ id: "session-server-denied", providerId: "openclaw", title: "Server" }),
        userInput: "run",
        settings: { providers: { openclaw: { enabled: true } } },
      }),
    });
    const json = await response.json();

    assert.equal(response.status, 403);
    assert.equal(json.ok, false);
    assert.equal(json.error, "Provider is not allowed: openclaw");
  } finally {
    await closeServer(server);
  }
});

test("bridge server executes turn through injected provider runner", async () => {
  const calls = [];
  const server = createBridgeServer({
    config: {
      ...DEFAULT_BRIDGE_CONFIG,
      token: "secret",
      allowedProviders: ["codex"],
      defaultCwd: "/Users/yanyunuo",
    },
    providerRunner: async (providerId, session, userInput, settings, options) => {
      calls.push({ providerId, session, userInput, settings, options });
      return {
        assistantText: "OK",
        command: "codex exec -",
      };
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/v1/turn`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "codex",
        session: createSession({ id: "session-server-ok", providerId: "codex", title: "Server" }),
        userInput: "run",
        settings: { providers: { codex: { enabled: true } } },
      }),
    });
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.assistantText, "OK");
    assert.equal(json.providerId, "codex");
    assert.equal(calls[0].providerId, "codex");
    assert.equal(calls[0].options.cwd, "/Users/yanyunuo");
  } finally {
    await closeServer(server);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `Cannot find module '../src/bridgeServer'`.

- [ ] **Step 3: Implement `src/bridgeServer.js`**

Create `/Users/yanyunuo/agent-chat-for-obsidian/src/bridgeServer.js` with:

```js
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
```

- [ ] **Step 4: Add manual bridge start script**

Create `/Users/yanyunuo/agent-chat-for-obsidian/scripts/agent-chat-bridge.js` with:

```js
#!/usr/bin/env node

const { createBridgeServer, defaultBridgeConfigPath, loadBridgeConfig } = require("../src/bridgeServer");

const configPath = process.argv[2] || defaultBridgeConfigPath();
const config = loadBridgeConfig(configPath);

if (!config.token) {
  console.error(`Agent Chat Bridge token is empty. Set token in ${configPath}.`);
  process.exit(1);
}

const server = createBridgeServer({ config });
server.listen(config.port, config.host, () => {
  console.log(`Agent Chat Bridge listening on http://${config.host}:${config.port}`);
  console.log(`Config: ${configPath}`);
});
```

Modify `package.json` scripts:

```json
"scripts": {
  "bridge": "node scripts/agent-chat-bridge.js",
  "build": "node scripts/build.js",
  "test": "npm run build && node --test"
}
```

- [ ] **Step 5: Run tests and syntax checks**

Run:

```bash
npm test
node --check src/bridgeServer.js
node --check scripts/agent-chat-bridge.js
```

Expected: PASS and no syntax errors.

- [ ] **Step 6: Commit server changes**

Run:

```bash
git add src/bridgeServer.js scripts/agent-chat-bridge.js package.json test/core.test.js
git commit -m "feat: add desktop agent bridge server"
```

Expected: commit succeeds.

---

### Task 3: Runtime Transport Selector for Desktop and Mobile

**Files:**
- Create: `/Users/yanyunuo/agent-chat-for-obsidian/src/turnTransport.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/test/core.test.js`

- [ ] **Step 1: Write failing transport tests**

Add this import:

```js
const { runTurnForRuntime } = require("../src/turnTransport");
```

Add these tests:

```js
test("runTurnForRuntime uses local runner on desktop", async () => {
  const calls = [];
  const result = await runTurnForRuntime({
    isMobile: false,
    providerId: "codex",
    session: createSession({ id: "session-desktop", providerId: "codex", title: "Desktop" }),
    userInput: "run locally",
    settings: {
      providers: { codex: { enabled: true } },
      remoteBridge: {
        enabled: true,
        url: "http://127.0.0.1:3876",
        token: "secret",
        timeoutMs: 1000,
      },
    },
    cwd: "/Users/yanyunuo",
    localRunner: async (providerId, session, userInput, settings, options) => {
      calls.push({ providerId, session, userInput, settings, options });
      return { assistantText: "LOCAL", command: "codex exec -" };
    },
    remoteRunner: async () => ({ assistantText: "REMOTE", command: "bridge" }),
  });

  assert.equal(result.transport, "local");
  assert.equal(result.assistantText, "LOCAL");
  assert.equal(calls[0].options.cwd, "/Users/yanyunuo");
});

test("runTurnForRuntime uses remote bridge on configured mobile", async () => {
  const calls = [];
  const result = await runTurnForRuntime({
    isMobile: true,
    providerId: "codex",
    session: createSession({ id: "session-mobile-remote", providerId: "codex", title: "Mobile" }),
    userInput: "run remote",
    settings: {
      providers: { codex: { enabled: true } },
      remoteBridge: {
        enabled: true,
        url: "http://127.0.0.1:3876",
        token: "secret",
        timeoutMs: 1000,
      },
    },
    cwd: "/Users/yanyunuo",
    localRunner: async () => ({ assistantText: "LOCAL", command: "codex exec -" }),
    remoteRunner: async (request) => {
      calls.push(request);
      return { assistantText: "REMOTE", command: "bridge" };
    },
  });

  assert.equal(result.transport, "remote");
  assert.equal(result.assistantText, "REMOTE");
  assert.equal(calls[0].providerId, "codex");
  assert.equal(calls[0].bridge.token, "secret");
});

test("runTurnForRuntime returns unavailable on mobile when default bridge lacks token", async () => {
  const result = await runTurnForRuntime({
    isMobile: true,
    providerId: "codex",
    session: createSession({ id: "session-mobile-disabled", providerId: "codex", title: "Mobile" }),
    userInput: "run unavailable",
    settings: {
      providers: { codex: { enabled: true } },
      remoteBridge: {
        enabled: true,
        url: "http://127.0.0.1:3876",
        token: "",
        timeoutMs: 1000,
      },
    },
    cwd: "/Users/yanyunuo",
    localRunner: async () => ({ assistantText: "LOCAL", command: "codex exec -" }),
    remoteRunner: async () => ({ assistantText: "REMOTE", command: "bridge" }),
  });

  assert.equal(result.transport, "unavailable");
  assert.equal(result.assistantText, "");
  assert.equal(result.command, "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `Cannot find module '../src/turnTransport'`.

- [ ] **Step 3: Implement `src/turnTransport.js`**

Create `/Users/yanyunuo/agent-chat-for-obsidian/src/turnTransport.js` with:

```js
const { hasRemoteBridgeConfig } = require("./bridgeClient");

async function runTurnForRuntime({
  isMobile,
  providerId,
  session,
  userInput,
  settings,
  cwd,
  localRunner,
  remoteRunner,
  runOptions = {},
}) {
  if (isMobile) {
    if (!hasRemoteBridgeConfig((settings || {}).remoteBridge)) {
      return {
        transport: "unavailable",
        assistantText: "",
        command: "",
        providerId,
      };
    }
    const result = await remoteRunner({
      bridge: settings.remoteBridge,
      providerId,
      session,
      userInput,
      settings,
    });
    return {
      transport: "remote",
      assistantText: result.assistantText || "",
      command: result.command || "",
      providerId: result.providerId || providerId,
    };
  }

  const result = await localRunner(providerId, session, userInput, settings, {
    ...runOptions,
    cwd,
  });
  return {
    transport: "local",
    assistantText: result.assistantText || "",
    command: result.command || "",
    providerId,
  };
}

module.exports = {
  runTurnForRuntime,
};
```

- [ ] **Step 4: Run tests to verify transport passes**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit transport selector**

Run:

```bash
git add src/turnTransport.js test/core.test.js
git commit -m "feat: route desktop and mobile agent turns"
```

Expected: commit succeeds.

---

### Task 4: Wire Plugin UI and Sending Logic

**Files:**
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/main.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/scripts/build.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/test/core.test.js`

- [ ] **Step 1: Add settings import and default settings**

Modify the imports at the top of `main.js`:

```js
const { DEFAULT_REMOTE_BRIDGE_SETTINGS, hasRemoteBridgeConfig, mergeRemoteBridgeSettings, requestBridgeTurn } = require("./src/bridgeClient");
const { runTurnForRuntime } = require("./src/turnTransport");
```

Modify `createDefaultSettings()`:

```js
function createDefaultSettings() {
  return {
    providers: mergeProviderSettings(),
    remoteBridge: mergeRemoteBridgeSettings(),
    defaultPlacement: "right",
    autoWriteback: true,
    obsidianWorkflow: { ...WORKFLOW_DEFAULTS },
  };
}
```

Modify `restore()` settings merge:

```js
this.settings = {
  ...createDefaultSettings(),
  ...(saved.settings || {}),
  providers: {
    ...mergeProviderSettings((saved.settings || {}).providers || {}),
  },
  remoteBridge: mergeRemoteBridgeSettings((saved.settings || {}).remoteBridge || {}),
  obsidianWorkflow: {
    ...WORKFLOW_DEFAULTS,
    ...(((saved.settings || {}).obsidianWorkflow) || {}),
    quickLinks: (((saved.settings || {}).obsidianWorkflow) || {}).quickLinks || WORKFLOW_DEFAULTS.quickLinks,
  },
};
```

- [ ] **Step 2: Update mobile banner and placeholder**

Replace the current mobile banner text in `AgentChatView.render()` with:

```js
text: hasRemoteBridgeConfig(this.plugin.settings.remoteBridge)
  ? "手机端模式：已启用桌面 Bridge，可远程执行 Agent；检测本地 CLI 仍只在桌面端运行。"
  : "手机端模式：可查看会话、写回、导出和派单；如需直接执行 Agent，请在设置中启用桌面 Bridge。",
```

Replace the mobile input placeholder with:

```js
placeholder: this.plugin.isMobileRuntime()
  ? (hasRemoteBridgeConfig(this.plugin.settings.remoteBridge) ? "通过桌面 Bridge 继续推进…" : "手机端会记录输入；执行请回桌面端、派单或配置 Bridge…")
  : "继续推进这个问题…",
```

- [ ] **Step 3: Add remote bridge settings UI**

In `AgentChatSettingTab.display()`, after the automatic writeback setting, add:

```js
containerEl.createEl("h3", { text: "手机端桌面 Bridge" });

new Setting(containerEl)
  .setName("启用手机端远程执行")
  .setDesc("默认开启。手机端会优先把对话请求发送到桌面 Mac 的 Agent Chat Bridge；桌面端默认仍直接运行本地 CLI。")
  .addToggle((toggle) => {
    toggle.setValue(this.plugin.settings.remoteBridge.enabled).onChange(async (value) => {
      this.plugin.settings.remoteBridge.enabled = value;
      await this.plugin.persist();
    });
  });

new Setting(containerEl)
  .setName("Bridge 地址")
  .setDesc("手机访问桌面 Mac 时应填写 Mac 的局域网地址，例如 http://192.168.1.2:3876。127.0.0.1 只代表当前设备；真实地址只保存在本地插件配置里。")
  .addText((text) => {
    text.setValue(this.plugin.settings.remoteBridge.url || DEFAULT_REMOTE_BRIDGE_SETTINGS.url).onChange(async (value) => {
      this.plugin.settings.remoteBridge.url = value.trim();
      await this.plugin.persist();
    });
  });

new Setting(containerEl)
  .setName("Bridge Token")
  .setDesc("必须和桌面 Bridge 配置中的 token 一致。默认不内置 token；不要把这个 token 写入普通笔记或公开仓库。")
  .addText((text) => {
    text.inputEl.type = "password";
    text.setValue(this.plugin.settings.remoteBridge.token || "").onChange(async (value) => {
      this.plugin.settings.remoteBridge.token = value.trim();
      await this.plugin.persist();
    });
  });

new Setting(containerEl)
  .setName("Bridge 超时毫秒")
  .setDesc("手机端等待桌面 Bridge 返回的最长时间。")
  .addText((text) => {
    text.setValue(String(this.plugin.settings.remoteBridge.timeoutMs || DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs)).onChange(async (value) => {
      const next = Number.parseInt(value, 10);
      this.plugin.settings.remoteBridge.timeoutMs = Number.isFinite(next) && next > 0 ? next : DEFAULT_REMOTE_BRIDGE_SETTINGS.timeoutMs;
      await this.plugin.persist();
    });
  });
```

- [ ] **Step 4: Replace mobile fallback with dual-mode execution**

In `sendMessageToActiveSession(userInput)`, replace the current `if (!this.canRunLocalProviders()) { ... return; }` block and local call setup with a single transport call.

The new flow inside the `try` block must call:

```js
const result = await runTurnForRuntime({
  isMobile: this.isMobileRuntime(),
  providerId,
  session: promptSession,
  userInput,
  settings: this.settings,
  cwd: this.app.vault.adapter.basePath,
  localRunner: runProviderTurn,
  remoteRunner: requestBridgeTurn,
  runOptions: {
    onSpawn: (child) => {
      this.running.set(session.id, child);
    },
    onStdout: (chunk, _stdout, spec) => {
      if (!spec || typeof spec.streamParser !== "function") {
        return;
      }
      const nextChunk = spec.streamParser(chunk);
      if (!nextChunk) {
        return;
      }
      streamedText += nextChunk;
      updateMessageContent(session, assistantMessage.id, streamedText);
      const now = Date.now();
      if (now - lastStreamRefresh > 250) {
        lastStreamRefresh = now;
        void this.refreshOpenViews();
      }
    },
  },
});
```

Before marking the session running, handle unavailable mobile mode:

```js
if (this.isMobileRuntime() && !hasRemoteBridgeConfig(this.settings.remoteBridge)) {
  upsertMessage(session, { role: "assistant", content: MOBILE_LOCAL_CLI_MESSAGE });
  recordProviderResult(this.state.providerStatus, providerId, {
    ok: false,
    message: "手机端记录输入，未配置桌面 Bridge。",
  });
  await this.persist();
  await this.refreshOpenViews();
  new Notice("已记录输入；请先填写桌面 Bridge URL 和 token，或回桌面端/任务板执行");
  return;
}
```

Keep `markProviderRunning(...)`, assistant placeholder, final message update, provider status recording, writeback queue, and error handling behavior from the existing function.

- [ ] **Step 5: Bundle new mobile modules**

Modify `scripts/build.js` `MODULES`:

```js
const MODULES = [
  ["./main", "main.js"],
  ["./src/sessionRegistry", "src/sessionRegistry.js"],
  ["./src/providers", "src/providers.js"],
  ["./src/bridgeClient", "src/bridgeClient.js"],
  ["./src/turnTransport", "src/turnTransport.js"],
  ["./src/sessionExport", "src/sessionExport.js"],
  ["./src/providerStatus", "src/providerStatus.js"],
  ["./src/writebackTargets", "src/writebackTargets.js"],
  ["./src/writeback", "src/writeback.js"],
  ["./src/agentStatusBridge", "src/agentStatusBridge.js"],
  ["./src/workflowConfig", "src/workflowConfig.js"],
  ["./src/promptCompiler", "src/promptCompiler.js"],
];
```

- [ ] **Step 6: Run tests and syntax checks**

Run:

```bash
npm test
node --check main.js
node --check scripts/build.js
node --check dist/main.js
```

Expected: PASS and no syntax errors.

- [ ] **Step 7: Commit plugin wiring**

Run:

```bash
git add main.js scripts/build.js test/core.test.js
git commit -m "feat: enable mobile bridge execution"
```

Expected: commit succeeds.

---

### Task 5: Docs, Version, Build, and Release Preparation

**Files:**
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/README.md`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/CHANGELOG.md`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/package.json`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/manifest.json`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/dist/main.js`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/dist/manifest.json`
- Modify: `/Users/yanyunuo/agent-chat-for-obsidian/dist/styles.css`

- [ ] **Step 1: Update README mobile section**

Replace the current mobile section with content covering:

```markdown
### 手机端说明

插件同时适配桌面端和手机端，但两端执行方式不同：

- 桌面端：默认直接运行本机 `codex / claude / hermes / openclaw` CLI。
- 手机端默认 Bridge 优先：插件设置里默认启用手机端远程执行，但不会内置真实 URL/token。
- 手机端未填写 Bridge token：可查看会话、写回、导出、派单到任务板，但不会直接运行本地 CLI。
- 手机端已填写 Bridge URL/token：通过桌面 Mac 的 Agent Chat Bridge 远程执行 agent，然后把回复写入同一个会话。

启动桌面 Bridge：

```bash
mkdir -p ~/.agent-chat-bridge
cat > ~/.agent-chat-bridge/config.json <<'JSON'
{
  "host": "127.0.0.1",
  "port": 3876,
  "token": "replace-with-a-random-token",
  "allowedProviders": ["codex", "claude", "hermes", "openclaw"],
  "defaultCwd": "/Users/yanyunuo"
}
JSON
npm run bridge
```

手机访问时，把 `host` 改成桌面 Mac 的局域网 IP，并在插件设置中填写同样的 URL 和 token。插件默认倾向使用 Bridge，但真实 URL/token 只保存在你的本地插件配置里。不要把 Bridge 暴露到公网；第一版只支持可信局域网使用。
```

- [ ] **Step 2: Update changelog and versions**

Set `package.json` version to:

```json
"version": "0.7.0"
```

Set `manifest.json` version to:

```json
"version": "0.7.0"
```

Add a `CHANGELOG.md` entry:

```markdown
## 0.7.0

- Added default-enabled desktop Agent Chat Bridge preference for mobile Obsidian execution.
- Kept desktop execution on the existing local CLI path by default.
- Added mobile Bridge settings for URL, token, and timeout; real secrets remain local.
- Added bridge client, bridge server, and runtime transport tests.
```

- [ ] **Step 3: Build release assets**

Run:

```bash
npm run build
```

Expected: `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` are regenerated.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
node --check main.js
node --check src/bridgeClient.js
node --check src/bridgeServer.js
node --check src/turnTransport.js
node --check scripts/agent-chat-bridge.js
node --check dist/main.js
```

Expected: all commands pass.

- [ ] **Step 5: Commit release prep**

Run:

```bash
git add README.md CHANGELOG.md package.json manifest.json dist/main.js dist/manifest.json dist/styles.css
git commit -m "chore: prepare mobile bridge release"
```

Expected: commit succeeds.

---

### Task 6: Obsidian Workflow Writeback and GitHub Release

**Files:**
- Modify: `/Users/yanyunuo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Documents/AI AGENTS/产出/Codex/最新项目更新.md`
- Modify: `/Users/yanyunuo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Documents/02-项目/Obsidian工作流/项目主页.md`
- Modify: `/Users/yanyunuo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Documents/02-项目/Obsidian工作流/设计文档/2026-05-29-Agent统一对话插件设计.md`

- [ ] **Step 1: Push commits**

Run:

```bash
git -C /Users/yanyunuo/agent-chat-for-obsidian status --short
git -C /Users/yanyunuo/agent-chat-for-obsidian push origin main
```

Expected: status is clean before push; push succeeds.

- [ ] **Step 2: Create GitHub release `v0.7.0`**

Run:

```bash
gh release create v0.7.0 \
  --repo YikR/agent-chat-for-obsidian \
  --title "v0.7.0" \
  --notes "Adds default-enabled mobile Agent Chat Bridge preference while keeping desktop local CLI execution as the default. Real Bridge URL/token remain local settings." \
  dist/main.js dist/manifest.json dist/styles.css
```

Expected: release exists with the three BRAT assets.

- [ ] **Step 3: Verify release assets**

Run:

```bash
gh release view v0.7.0 --repo YikR/agent-chat-for-obsidian
```

Expected: assets list includes `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 4: Write Obsidian project update**

Update the Codex latest page top block with:

```markdown
## 2026-05-30 Agent Chat v0.7.0 双端适配

- 任务：让 Agent Chat 同时适配桌面端和手机端。
- 结果：桌面端继续默认直接调用本机 CLI；手机端默认启用桌面 Agent Chat Bridge 偏好，填写本地 URL/token 后通过局域网远程执行，未填写 token 时仍保留工作台/派单兜底。Bridge 使用局域网 HTTP + bearer token，第一版不支持公网暴露。
- 验证：`npm test`、`node --check main.js`、`node --check src/bridgeClient.js`、`node --check src/bridgeServer.js`、`node --check src/turnTransport.js`、`node --check scripts/agent-chat-bridge.js`、`node --check dist/main.js`。
- 发布：GitHub release `v0.7.0`。
```

Update the project homepage recent block with one concise entry linking the release and the design/plan docs.

Update the design document with an implementation supplement that records the dual-mode decision:

```markdown
## 2026-05-30 实施补充：0.7.0 双端适配

- 桌面端：继续以本机 CLI 为默认执行路径。
- 手机端：默认 Bridge 优先；未填写本地 URL/token 时仅作为工作台，配置桌面 Bridge 后通过局域网远程执行 agent。
- 安全边界：token 鉴权、局域网优先、不把模型/API 密钥放到手机端。
```

- [ ] **Step 5: Final verification**

Run:

```bash
git -C /Users/yanyunuo/agent-chat-for-obsidian status --short
gh release view v0.7.0 --repo YikR/agent-chat-for-obsidian
```

Expected: plugin repo is clean and release is visible.
