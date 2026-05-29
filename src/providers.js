const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { buildPromptFromSession } = require("./promptCompiler");

const DEFAULT_PROVIDER_SETTINGS = {
  codex: {
    enabled: true,
    label: "Codex",
    cliPath: "codex",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
  },
  claude: {
    enabled: true,
    label: "Claude",
    cliPath: "claude",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
  },
  hermes: {
    enabled: true,
    label: "Hermes",
    cliPath: "hermes",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
  },
  openclaw: {
    enabled: true,
    label: "OpenClaw",
    cliPath: "openclaw",
    cwd: "",
    timeoutMs: 10 * 60 * 1000,
    extraArgs: "",
  },
};

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

function createSpawnSpec(providerId, session, userInput, settings, options = {}) {
  const config = getProviderConfig(settings, providerId);
  const cwd = config.cwd || options.cwd || process.cwd();
  const prompt = buildPromptFromSession(session, userInput, {
    maxHistoryMessages: 8,
  });
  const extraArgs = splitArgs(config.extraArgs);

  if (providerId === "codex") {
    const outputFile = path.join(os.tmpdir(), `agent-chat-codex-${Date.now()}.txt`);
    return {
      cliPath: config.cliPath,
      args: [
        "exec",
        "--skip-git-repo-check",
        "--output-last-message",
        outputFile,
        ...extraArgs,
        "-",
      ],
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
    return {
      cliPath: config.cliPath,
      args: ["-p", "--output-format", "text", ...extraArgs, prompt],
      cwd,
      stdin: null,
      outputParser: (stdout) => stdout.trim(),
    };
  }

  if (providerId === "hermes") {
    return {
      cliPath: config.cliPath,
      args: ["--oneshot", prompt, ...extraArgs],
      cwd,
      stdin: null,
      outputParser: (stdout) => stdout.trim(),
    };
  }

  if (providerId === "openclaw") {
    return {
      cliPath: config.cliPath,
      args: [
        "agent",
        "--local",
        "--json",
        "--session-key",
        `agent:main:plugin-${session.id}`,
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
  return new Promise((resolve, reject) => {
    const child = spawn(spec.cliPath, spec.args, {
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
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
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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
  createProbeSession,
  createSpawnSpec,
  getProviderConfig,
  probeProvider,
  runProviderTurn,
};
