const { buildPromptFromSession } = require("./promptCompiler");

const DEFAULT_PROVIDER_SETTINGS = {
  codex: {
    enabled: true,
    label: "Codex",
    cliPath: "codex",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
    nativeResume: true,
  },
  claude: {
    enabled: true,
    label: "Claude",
    cliPath: "claude",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
    nativeResume: true,
  },
  hermes: {
    enabled: true,
    label: "Hermes",
    cliPath: "hermes",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
    nativeResume: true,
  },
  openclaw: {
    enabled: true,
    label: "OpenClaw",
    cliPath: "openclaw",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
    nativeResume: true,
  },
};

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((item) => {
    if (!item || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function buildExecutionEnv(baseEnv = process.env) {
  const os = require("node:os");
  const path = require("node:path");
  const home = baseEnv.HOME || os.homedir();
  const basePath = baseEnv.PATH || "";
  const extraPaths = [
    path.join(home, ".local", "bin"),
    path.join(home, ".local", "nodejs-v22.22.2", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  return {
    ...baseEnv,
    PATH: uniquePaths([...extraPaths, ...basePath.split(path.delimiter)]).join(path.delimiter),
  };
}

function splitArgs(text) {
  return String(text || "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getProviderConfig(settings, providerId) {
  const configured = (((settings || {}).providers || {})[providerId]) || {};
  return {
    ...DEFAULT_PROVIDER_SETTINGS[providerId],
    ...configured,
  };
}

function extractOpenClawText(raw) {
  try {
    const parsed = JSON.parse(raw);
    const candidates = [
      parsed.final,
      parsed.reply,
      parsed.text,
      parsed.message,
      parsed.output,
      parsed.result,
      parsed.response,
      parsed.assistant,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch (_error) {
    // ignore parse failure
  }
  return raw.trim();
}

function stableUuid(seed) {
  let hash = "";
  for (let i = 0; hash.length < 32; i += 1) {
    let value = 0x811c9dc5 ^ i;
    for (const char of `${seed}:${i}`) {
      value ^= char.charCodeAt(0);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    hash += value.toString(16).padStart(8, "0");
  }
  hash = hash.slice(0, 32);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

function ensureNativeSessions(session) {
  if (!session.nativeSessions || typeof session.nativeSessions !== "object") {
    session.nativeSessions = {};
  }
  return session.nativeSessions;
}

function resolveNativeSession(providerId, session) {
  const nativeSessions = ensureNativeSessions(session);
  if (providerId === "claude") {
    nativeSessions.claude = {
      ...nativeSessions.claude,
      sessionId: (nativeSessions.claude || {}).sessionId || stableUuid(`agent-chat:${session.id}:claude`),
    };
    return nativeSessions.claude;
  }
  if (providerId === "hermes") {
    nativeSessions.hermes = {
      ...nativeSessions.hermes,
      sessionName: (nativeSessions.hermes || {}).sessionName || `agent-chat-${session.id}`,
    };
    return nativeSessions.hermes;
  }
  if (providerId === "openclaw") {
    nativeSessions.openclaw = {
      ...nativeSessions.openclaw,
      sessionKey: (nativeSessions.openclaw || {}).sessionKey || `agent:main:plugin-${session.id}`,
    };
    return nativeSessions.openclaw;
  }
  if (providerId === "codex") {
    return nativeSessions.codex || {};
  }
  return {};
}

function shouldUseNativeResume(providerId, session, config) {
  if (!config.nativeResume) {
    return false;
  }
  if (providerId === "codex") {
    const nativeSession = resolveNativeSession(providerId, session);
    return Boolean(nativeSession.sessionId || nativeSession.threadName);
  }
  return providerId === "claude" || providerId === "hermes" || providerId === "openclaw";
}

function passthroughStreamChunk(chunk) {
  return String(chunk || "");
}

function createSpawnSpec(providerId, session, userInput, settings, options = {}) {
  const config = getProviderConfig(settings, providerId);
  const cwd = config.cwd || options.cwd || process.cwd();
  const nativeResume = shouldUseNativeResume(providerId, session, config);
  const prompt = buildPromptFromSession(session, userInput, {
    maxHistoryMessages: nativeResume ? 0 : 8,
  });
  const extraArgs = splitArgs(config.extraArgs);

  if (providerId === "codex") {
    const os = require("node:os");
    const path = require("node:path");
    const fs = require("node:fs");
    const outputFile = path.join(os.tmpdir(), `agent-chat-codex-${Date.now()}.txt`);
    const nativeSession = resolveNativeSession(providerId, session);
    const resumeTarget = nativeSession.sessionId || nativeSession.threadName;
    const args = resumeTarget
      ? [
          "exec",
          "resume",
          "--skip-git-repo-check",
          "--output-last-message",
          outputFile,
          ...extraArgs,
          resumeTarget,
          "-",
        ]
      : [
          "exec",
          "--skip-git-repo-check",
          "--output-last-message",
          outputFile,
          ...extraArgs,
          "-",
        ];
    return {
      cliPath: config.cliPath,
      args,
      cwd,
      stdin: prompt,
      outputFile,
      outputParser: (stdout) => {
        if (fs.existsSync(outputFile)) {
          return fs.readFileSync(outputFile, "utf8").trim() || stdout.trim();
        }
        return stdout.trim();
      },
    };
  }

  if (providerId === "claude") {
    const nativeSession = resolveNativeSession(providerId, session);
    return {
      cliPath: config.cliPath,
      args: [
        "-p",
        "--output-format",
        "text",
        ...(nativeResume ? ["--session-id", nativeSession.sessionId] : []),
        ...extraArgs,
        prompt,
      ],
      cwd,
      stdin: null,
      outputParser: (stdout) => stdout.trim(),
      streamParser: passthroughStreamChunk,
    };
  }

  if (providerId === "hermes") {
    const nativeSession = resolveNativeSession(providerId, session);
    return {
      cliPath: config.cliPath,
      args: [
        ...(nativeResume ? ["--continue", nativeSession.sessionName] : []),
        "--oneshot",
        prompt,
        ...extraArgs,
      ],
      cwd,
      stdin: null,
      outputParser: (stdout) => stdout.trim(),
      streamParser: passthroughStreamChunk,
    };
  }

  if (providerId === "openclaw") {
    const nativeSession = resolveNativeSession(providerId, session);
    return {
      cliPath: config.cliPath,
      args: [
        "agent",
        "--local",
        "--json",
        "--session-key",
        nativeSession.sessionKey,
        "--message",
        prompt,
        ...extraArgs,
      ],
      cwd,
      stdin: null,
      outputParser: extractOpenClawText,
    };
  }

  throw new Error(`Unsupported provider: ${providerId}`);
}

function createProbeSession(providerId) {
  const now = new Date().toISOString();
  return {
    id: `probe-${providerId}`,
    providerId,
    title: "Agent 可用性检测",
    projectPath: "",
    messages: [],
    lastWriteback: [],
    createdAt: now,
    updatedAt: now,
  };
}

function runSpawnSpec(spec, timeoutMs, options = {}) {
  const { spawn } = require("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(spec.cliPath, spec.args, {
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildExecutionEnv(process.env),
    });
    if (typeof options.onSpawn === "function") {
      options.onSpawn(child);
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (typeof options.onStdout === "function") {
        options.onStdout(text, stdout, spec);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (typeof options.onStderr === "function") {
        options.onStderr(text, stderr, spec);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Command exited with code ${code}`));
        return;
      }
      resolve({
        child,
        stdout,
        stderr,
      });
    });

    if (spec.stdin) {
      child.stdin.write(spec.stdin);
    }
    child.stdin.end();
  });
}

async function runProviderTurn(providerId, session, userInput, settings, options = {}) {
  const config = getProviderConfig(settings, providerId);
  const spec = createSpawnSpec(providerId, session, userInput, settings, options);
  const result = await runSpawnSpec(spec, config.timeoutMs, options);
  const assistantText = spec.outputParser(result.stdout, result.stderr);

  return {
    assistantText: assistantText || "(No response text returned)",
    command: [spec.cliPath, ...spec.args].join(" "),
  };
}

async function probeProvider(providerId, settings, options = {}) {
  const config = getProviderConfig(settings, providerId);
  const session = createProbeSession(providerId);
  return runProviderTurn(providerId, session, "Reply with exactly: OK", {
    ...settings,
    providers: {
      ...((settings || {}).providers || {}),
      [providerId]: {
        ...config,
        timeoutMs: Math.min(config.timeoutMs || 30000, options.timeoutMs || 30000),
      },
    },
  }, options);
}

module.exports = {
  DEFAULT_PROVIDER_SETTINGS,
  buildExecutionEnv,
  createProbeSession,
  createSpawnSpec,
  getProviderConfig,
  probeProvider,
  resolveNativeSession,
  runProviderTurn,
};
