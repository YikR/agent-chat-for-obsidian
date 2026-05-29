const { Plugin, ItemView, PluginSettingTab, Setting, Notice, MarkdownView, Platform } = require("obsidian");

const { createDefaultState, createSession, updateMessageContent, upsertMessage } = require("./src/sessionRegistry");
const { DEFAULT_PROVIDER_SETTINGS, probeProvider, runProviderTurn } = require("./src/providers");
const { makeSessionExportPath, renderSessionMarkdown } = require("./src/sessionExport");
const { markProviderRunning, recordProviderResult, summarizeProviderStatus } = require("./src/providerStatus");
const { resolveWritebackTargets } = require("./src/writebackTargets");
const { writebackSessionResult } = require("./src/writeback");
const { WORKFLOW_DEFAULTS, formatTaskBoardRow, insertTaskRow } = require("./src/workflowConfig");

const VIEW_TYPE_AGENT_CHAT = "agent-chat-view";
const MOBILE_LOCAL_CLI_MESSAGE = "手机端 Obsidian 不能直接运行本机 CLI Agent。已把这条输入记录在会话里；如需执行，请同步到桌面端继续运行，或使用“派单到任务板”进入调度流。";

function cloneProviderSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_PROVIDER_SETTINGS));
}

function mergeProviderSettings(savedProviders = {}) {
  const defaults = cloneProviderSettings();
  const merged = {};
  for (const providerId of Object.keys(defaults)) {
    merged[providerId] = {
      ...defaults[providerId],
      ...((savedProviders || {})[providerId] || {}),
    };
  }
  return merged;
}

function createDefaultSettings() {
  return {
    providers: mergeProviderSettings(),
    defaultPlacement: "right",
    autoWriteback: true,
    obsidianWorkflow: { ...WORKFLOW_DEFAULTS },
  };
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class AgentChatView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_AGENT_CHAT;
  }

  getDisplayText() {
    return "Agent 对话";
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    this.contentEl.empty();
  }

  async render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("agent-chat-root");

    const session = this.plugin.getActiveSession();
    if (!session) {
      this.plugin.createTab("codex");
      return this.render();
    }
    const isRunning = this.plugin.isSessionRunning(session.id);

    const statusBar = container.createDiv({ cls: "agent-chat-statusbar" });
    for (const providerId of Object.keys(this.plugin.settings.providers)) {
      const provider = this.plugin.settings.providers[providerId];
      const status = this.plugin.state.providerStatus[providerId];
      const text = summarizeProviderStatus(status, provider.enabled);
      const item = statusBar.createDiv({
        cls: `agent-chat-provider-status status-${(status || {}).state || (provider.enabled ? "unknown" : "disabled")}`,
      });
      item.createSpan({ cls: "agent-chat-provider-dot" });
      item.createSpan({ text: `${this.plugin.providerLabel(providerId)}：${text}` });
      if (status && (status.lastError || status.lastMessage)) {
        item.setAttr("title", status.lastError || status.lastMessage);
      }
    }

    if (this.plugin.isMobileRuntime()) {
      container.createDiv({
        cls: "agent-chat-mobile-banner",
        text: "手机端模式：可查看会话、写回、导出和派单；本地 CLI Agent 只能在桌面端运行。",
      });
    }

    const controlPanel = container.createDiv({ cls: "agent-chat-controlpanel" });
    const contextRow = controlPanel.createDiv({ cls: "agent-chat-context-row" });

    const providerSelect = contextRow.createEl("select", { cls: "agent-chat-provider" });
    for (const providerId of Object.keys(this.plugin.settings.providers)) {
      const option = providerSelect.createEl("option", { text: this.plugin.providerLabel(providerId) });
      option.value = providerId;
      option.selected = providerId === session.providerId;
    }
    providerSelect.onchange = async () => {
      this.plugin.setActiveProvider(providerSelect.value);
      await this.render();
    };

    const titleInput = contextRow.createEl("input", {
      cls: "agent-chat-title",
      type: "text",
      placeholder: "会话标题",
      value: session.title || "",
    });
    titleInput.onchange = async () => {
      this.plugin.renameActiveSession(titleInput.value.trim());
      await this.plugin.persist();
      await this.render();
    };

    const projectInput = contextRow.createEl("input", {
      cls: "agent-chat-project",
      type: "text",
      placeholder: "绑定项目页路径，例如 02-项目/Obsidian工作流/项目主页.md",
      value: session.projectPath || "",
    });
    projectInput.onchange = async () => {
      this.plugin.setProjectPath(projectInput.value.trim());
      await this.plugin.persist();
    };

    if (this.plugin.settings.obsidianWorkflow.enabled) {
      const workflowDetails = controlPanel.createEl("details", { cls: "agent-chat-workflow-details" });
      workflowDetails.createEl("summary", { text: "工作流入口" });
      const workflowBar = workflowDetails.createDiv({ cls: "agent-chat-workflowbar" });
      for (const link of this.plugin.settings.obsidianWorkflow.quickLinks) {
        const button = workflowBar.createEl("button", { text: link.label });
        button.onclick = async () => {
          await this.plugin.openWorkflowNote(link.path);
          workflowDetails.removeAttribute("open");
        };
      }
    }

    const actionRow = controlPanel.createDiv({ cls: "agent-chat-action-row" });
    const primaryActions = actionRow.createDiv({ cls: "agent-chat-button-group" });
    const secondaryActions = actionRow.createEl("details", { cls: "agent-chat-more-actions" });
    secondaryActions.createEl("summary", { text: "更多" });
    const moreActions = secondaryActions.createDiv({ cls: "agent-chat-more-actions-menu" });

    const newTabButton = primaryActions.createEl("button", { text: "新会话" });
    newTabButton.onclick = async () => {
      this.plugin.createTab(session.providerId);
      await this.render();
    };

    const probeAllButton = primaryActions.createEl("button", { text: "检测全部 Agent" });
    probeAllButton.disabled = this.plugin.isMobileRuntime();
    if (this.plugin.isMobileRuntime()) {
      probeAllButton.setAttr("title", "手机端不能运行本地 CLI 检测");
    }
    probeAllButton.onclick = async () => {
      await this.plugin.probeAllProviders();
      await this.render();
    };

    const bindCurrentButton = moreActions.createEl("button", { text: "绑定当前笔记" });
    bindCurrentButton.onclick = async () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = activeView == null ? void 0 : activeView.file;
      if (!file) {
        new Notice("当前没有活动 Markdown 笔记");
        return;
      }
      this.plugin.setProjectPath(file.path);
      secondaryActions.removeAttribute("open");
      await this.render();
      await this.plugin.persist();
    };

    const dispatchButton = moreActions.createEl("button", { text: "派单到任务板" });
    dispatchButton.onclick = async () => {
      await this.plugin.dispatchActiveSessionToTaskBoard();
      secondaryActions.removeAttribute("open");
    };

    const writebackButton = moreActions.createEl("button", { text: "写回" });
    writebackButton.onclick = async () => {
      await this.plugin.writebackActiveSession();
      secondaryActions.removeAttribute("open");
      await this.render();
    };

    const exportButton = moreActions.createEl("button", { text: "导出" });
    exportButton.onclick = async () => {
      await this.plugin.exportActiveSession();
      secondaryActions.removeAttribute("open");
    };

    const stopButton = moreActions.createEl("button", { text: "停止" });
    stopButton.disabled = !isRunning;
    stopButton.onclick = () => {
      this.plugin.stopActiveRun();
      secondaryActions.removeAttribute("open");
    };

    const tabsBar = container.createDiv({ cls: "agent-chat-tabs" });
    for (const tab of this.plugin.state.tabs) {
      const tabSession = this.plugin.state.sessions[tab.sessionId];
      const tabButton = tabsBar.createDiv({
        cls: `agent-chat-tab${tab.id === this.plugin.state.activeTabId ? " is-active" : ""}`,
      });
      tabButton.createSpan({ text: (tabSession == null ? void 0 : tabSession.title) || "新会话" });
      const close = tabButton.createEl("button", { cls: "agent-chat-tab-close", text: "×" });
      close.onclick = async (event) => {
        event.stopPropagation();
        this.plugin.closeTab(tab.id);
        await this.render();
      };
      tabButton.onclick = async () => {
        this.plugin.state.activeTabId = tab.id;
        await this.plugin.persist();
        await this.render();
      };
    }

    const transcript = container.createDiv({ cls: "agent-chat-transcript" });
    for (const message of session.messages) {
      const messageEl = transcript.createDiv({ cls: `agent-chat-message role-${message.role}` });
      const meta = messageEl.createDiv({
        cls: "agent-chat-message-meta",
        text: message.role === "user" ? "用户" : "助手",
      });
      meta.setAttr("data-created-at", message.createdAt || "");
      messageEl.createDiv({ cls: "agent-chat-message-body", text: message.content });
    }

    const footer = container.createDiv({ cls: "agent-chat-footer" });
    const input = footer.createEl("textarea", {
      cls: "agent-chat-input",
      placeholder: this.plugin.isMobileRuntime() ? "手机端会记录输入；执行请回桌面端或派单…" : "继续推进这个问题…",
    });
    input.onkeydown = async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        send.click();
      }
    };
    const send = footer.createEl("button", { text: "发送" });
    send.disabled = isRunning;
    send.onclick = async () => {
      const value = input.value.trim();
      if (!value) {
        return;
      }
      input.value = "";
      void this.plugin.sendMessageToActiveSession(value);
      await this.render();
    };
  }
}

class AgentChatSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    if (this.plugin.isMobileRuntime()) {
      containerEl.createDiv({
        cls: "agent-chat-mobile-settings-note",
        text: "当前是手机端 Obsidian：插件会以移动工作台模式运行，本地 CLI 路径、工作目录和检测功能只在桌面端生效。",
      });
    }

    new Setting(containerEl)
      .setName("自动写回")
      .setDesc("每轮对话完成后，把摘要写回对应的 Obsidian 最新页、最近活动页和绑定项目页。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoWriteback).onChange(async (value) => {
          this.plugin.settings.autoWriteback = value;
          await this.plugin.persist();
        });
      });

    new Setting(containerEl)
      .setName("启用专用 Obsidian 工作流")
      .setDesc("启用后，插件会默认绑定 Obsidian工作流项目页，并显示工作台、任务板、项目主页等快捷入口。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.obsidianWorkflow.enabled).onChange(async (value) => {
          this.plugin.settings.obsidianWorkflow.enabled = value;
          await this.plugin.persist();
        });
      });

    new Setting(containerEl)
      .setName("默认项目页")
      .setDesc("新会话默认绑定到这个项目页。")
      .addText((text) => {
        text.setValue(this.plugin.settings.obsidianWorkflow.defaultProjectPath).onChange(async (value) => {
          this.plugin.settings.obsidianWorkflow.defaultProjectPath = value.trim();
          await this.plugin.persist();
        });
      });

    new Setting(containerEl)
      .setName("Agent任务板路径")
      .setDesc("点击派单到任务板时，会把当前会话作为待处理任务写入这个页面。")
      .addText((text) => {
        text.setValue(this.plugin.settings.obsidianWorkflow.taskBoardPath).onChange(async (value) => {
          this.plugin.settings.obsidianWorkflow.taskBoardPath = value.trim();
          await this.plugin.persist();
        });
      });

    for (const providerId of Object.keys(this.plugin.settings.providers)) {
      const provider = this.plugin.settings.providers[providerId];
      containerEl.createEl("h3", { text: this.plugin.providerLabel(providerId) });

      new Setting(containerEl)
        .setName(`${this.plugin.providerLabel(providerId)} 启用`)
        .addToggle((toggle) => {
          toggle.setValue(provider.enabled).onChange(async (value) => {
            provider.enabled = value;
            await this.plugin.persist();
          });
        });

      new Setting(containerEl)
        .setName(`${this.plugin.providerLabel(providerId)} 原生续接`)
        .setDesc("优先使用 CLI 自带 session/resume 能力；不可用时仍使用会话历史 prompt 兜底。")
        .addToggle((toggle) => {
          toggle.setValue(provider.nativeResume !== false).onChange(async (value) => {
            provider.nativeResume = value;
            await this.plugin.persist();
          });
        });

      new Setting(containerEl)
        .setName(`${this.plugin.providerLabel(providerId)} CLI 路径`)
        .addText((text) => {
          text.setValue(provider.cliPath).onChange(async (value) => {
            provider.cliPath = value.trim();
            await this.plugin.persist();
          });
        });

      new Setting(containerEl)
        .setName(`${this.plugin.providerLabel(providerId)} 工作目录`)
        .setDesc("留空时使用当前 vault 路径。")
        .addText((text) => {
          text.setValue(provider.cwd || "").onChange(async (value) => {
            provider.cwd = value.trim();
            await this.plugin.persist();
          });
        });

      new Setting(containerEl)
        .setName(`${this.plugin.providerLabel(providerId)} 额外参数`)
        .setDesc("可选 CLI 参数，会追加到该 provider 命令末尾。")
        .addText((text) => {
          text.setValue(provider.extraArgs || "").onChange(async (value) => {
            provider.extraArgs = value;
            await this.plugin.persist();
          });
        });
    }
  }
}

module.exports = class AgentChatPlugin extends Plugin {
  async onload() {
    this.state = createDefaultState();
    this.settings = createDefaultSettings();
    this.running = new Map();
    this.writebackQueue = [];
    this.writebackProcessing = false;

    await this.restore();

    this.registerView(VIEW_TYPE_AGENT_CHAT, (leaf) => new AgentChatView(leaf, this));
    this.addRibbonIcon("bot", "打开 Agent 对话", async () => {
      await this.activateView();
    });
    this.addCommand({
      id: "open-agent-chat-view",
      name: "打开 Agent 对话",
      callback: async () => {
        await this.activateView();
      },
    });
    this.addCommand({
      id: "probe-all-agent-chat-providers",
      name: "检测全部 Agent 状态",
      callback: async () => {
        await this.probeAllProviders();
      },
    });
    this.addSettingTab(new AgentChatSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_CHAT);
  }

  providerLabel(providerId) {
    return (this.settings.providers[providerId] || {}).label || providerId;
  }

  isMobileRuntime() {
    return Boolean(Platform && Platform.isMobile);
  }

  canRunLocalProviders() {
    return !this.isMobileRuntime();
  }

  async restore() {
    const saved = (await this.loadData()) || {};
    this.settings = {
      ...createDefaultSettings(),
      ...(saved.settings || {}),
      providers: {
        ...mergeProviderSettings((saved.settings || {}).providers || {}),
      },
      obsidianWorkflow: {
        ...WORKFLOW_DEFAULTS,
        ...(((saved.settings || {}).obsidianWorkflow) || {}),
        quickLinks: (((saved.settings || {}).obsidianWorkflow) || {}).quickLinks || WORKFLOW_DEFAULTS.quickLinks,
      },
    };
    this.state = {
      ...createDefaultState(),
      ...(saved.state || {}),
      sessions: (saved.state || {}).sessions || {},
      tabs: (saved.state || {}).tabs || [],
      activeTabId: (saved.state || {}).activeTabId || null,
      providerStatus: (saved.state || {}).providerStatus || {},
    };
  }

  async persist() {
    await this.saveData({
      settings: this.settings,
      state: this.state,
    });
  }

  async activateView() {
    const leaf = this.isMobileRuntime() ? this.app.workspace.getLeaf(true) : this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_AGENT_CHAT,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  createTab(providerId) {
    const sessionId = makeId("session");
    const tabId = makeId("tab");
    const session = createSession({
      id: sessionId,
      providerId,
      title: `${this.providerLabel(providerId)} 新会话`,
      projectPath: this.settings.obsidianWorkflow.enabled ? this.settings.obsidianWorkflow.defaultProjectPath : "",
    });
    this.state.sessions[sessionId] = session;
    this.state.tabs.push({
      id: tabId,
      sessionId,
    });
    this.state.activeTabId = tabId;
    void this.persist();
    return session;
  }

  getActiveTab() {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId) || null;
  }

  getActiveSession() {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return null;
    }
    return this.state.sessions[activeTab.sessionId] || null;
  }

  setActiveProvider(providerId) {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    session.providerId = providerId;
    if (!session.title || session.title.startsWith("New ")) {
      session.title = `${this.providerLabel(providerId)} 新会话`;
    }
    void this.persist();
  }

  renameActiveSession(title) {
    const session = this.getActiveSession();
    if (!session || !title) {
      return;
    }
    session.title = title;
    void this.persist();
  }

  setProjectPath(projectPath) {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    session.projectPath = projectPath;
    void this.persist();
  }

  closeTab(tabId) {
    const nextTabs = this.state.tabs.filter((tab) => tab.id !== tabId);
    const removed = this.state.tabs.find((tab) => tab.id === tabId);
    this.state.tabs = nextTabs;
    if (removed) {
      delete this.state.sessions[removed.sessionId];
      this.running.delete(removed.sessionId);
    }
    if (!nextTabs.length) {
      this.state.activeTabId = null;
      this.createTab("codex");
      return;
    }
    if (this.state.activeTabId === tabId) {
      this.state.activeTabId = nextTabs[0].id;
    }
    void this.persist();
  }

  stopActiveRun() {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    const running = this.running.get(session.id);
    if (running && typeof running.kill === "function") {
      running.kill("SIGTERM");
      new Notice("已停止当前 Agent 运行");
    }
  }

  isSessionRunning(sessionId) {
    return this.running.has(sessionId);
  }

  getLastAssistantMessage(session) {
    return [...(session.messages || [])].reverse().find((message) => message.role === "assistant") || null;
  }

  async writebackActiveSession() {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    const lastAssistant = this.getLastAssistantMessage(session);
    if (!lastAssistant) {
      new Notice("当前会话还没有可写回的助手回复");
      return;
    }
    this.enqueueWriteback(session.providerId, session.id, lastAssistant.content);
    await this.persist();
    new Notice("已加入 Obsidian 写回队列");
  }

  enqueueWriteback(providerId, sessionId, assistantText) {
    const session = this.state.sessions[sessionId];
    if (!session) {
      return;
    }
    this.writebackQueue.push({
      id: makeId("writeback"),
      providerId,
      sessionId,
      assistantText,
      sessionSnapshot: {
        ...session,
        messages: [...(session.messages || [])],
        lastWriteback: [...(session.lastWriteback || [])],
      },
    });
    void this.processWritebackQueue();
  }

  async processWritebackQueue() {
    if (this.writebackProcessing) {
      return;
    }
    this.writebackProcessing = true;
    try {
      while (this.writebackQueue.length) {
        const job = this.writebackQueue.shift();
        try {
          const targets = resolveWritebackTargets(job.providerId, job.sessionSnapshot.projectPath);
          const writes = await writebackSessionResult(
            this.app,
            job.providerId,
            job.sessionSnapshot,
            job.assistantText,
            targets,
          );
          const liveSession = this.state.sessions[job.sessionId];
          if (liveSession) {
            liveSession.lastWriteback = writes;
          }
          await this.persist();
          await this.refreshOpenViews();
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          new Notice(`Obsidian 写回失败：${message}`);
        }
      }
    } finally {
      this.writebackProcessing = false;
    }
  }

  async ensureFolderPath(folderPath) {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await this.app.vault.createFolder(current).catch(() => {});
    }
  }

  async exportActiveSession() {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    const filePath = makeSessionExportPath(session);
    const folder = filePath.split("/").slice(0, -1).join("/");
    await this.ensureFolderPath(folder);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    const markdown = renderSessionMarkdown(session, this.providerLabel(session.providerId));
    if (existing) {
      await this.app.vault.modify(existing, markdown);
    } else {
      await this.app.vault.create(filePath, markdown);
    }
    new Notice(`已导出会话：${filePath}`);
  }

  async openWorkflowNote(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      new Notice(`找不到页面：${path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async dispatchActiveSessionToTaskBoard() {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }
    const taskBoardPath = this.settings.obsidianWorkflow.taskBoardPath;
    const file = this.app.vault.getAbstractFileByPath(taskBoardPath);
    if (!file) {
      new Notice(`找不到 Agent任务板：${taskBoardPath}`);
      return;
    }
    const original = await this.app.vault.read(file);
    const next = insertTaskRow(original, formatTaskBoardRow(session));
    await this.app.vault.modify(file, next);
    new Notice("已派单到 Agent任务板");
  }

  getProviderIds() {
    return Object.keys(this.settings.providers || {});
  }

  async refreshOpenViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_CHAT);
    for (const leaf of leaves) {
      if (leaf.view && typeof leaf.view.render === "function") {
        await leaf.view.render();
      }
    }
  }

  async probeOneProvider(providerId) {
    if (!this.canRunLocalProviders()) {
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message: "手机端不能运行本地 CLI Agent，请在桌面端检测。",
      });
      await this.persist();
      await this.refreshOpenViews();
      return;
    }

    const provider = this.settings.providers[providerId];
    if (!provider || !provider.enabled) {
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message: "该 Agent 已在设置中停用",
      });
      await this.persist();
      return;
    }

    markProviderRunning(this.state.providerStatus, providerId);
    await this.persist();
    await this.refreshOpenViews();

    try {
      const result = await probeProvider(providerId, this.settings, {
        cwd: this.app.vault.adapter.basePath,
        timeoutMs: 30000,
      });
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: true,
        message: result.assistantText,
        command: result.command,
      });
    } catch (error) {
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message: error && error.message ? error.message : String(error),
      });
    }
    await this.persist();
    await this.refreshOpenViews();
  }

  async probeAllProviders() {
    if (!this.canRunLocalProviders()) {
      for (const providerId of this.getProviderIds()) {
        recordProviderResult(this.state.providerStatus, providerId, {
          ok: false,
          message: "手机端不能运行本地 CLI Agent，请在桌面端检测。",
        });
      }
      await this.persist();
      await this.refreshOpenViews();
      new Notice("手机端不能运行本地 CLI 检测");
      return;
    }

    new Notice("开始检测全部 Agent");
    const providerIds = this.getProviderIds();
    const enabledIds = [];
    for (const providerId of providerIds) {
      const provider = this.settings.providers[providerId];
      if (!provider || !provider.enabled) {
        recordProviderResult(this.state.providerStatus, providerId, {
          ok: false,
          message: "该 Agent 已在设置中停用",
        });
        continue;
      }
      enabledIds.push(providerId);
      markProviderRunning(this.state.providerStatus, providerId);
    }
    await this.persist();
    await this.refreshOpenViews();

    await Promise.all(enabledIds.map(async (providerId) => {
      try {
        const result = await probeProvider(providerId, this.settings, {
          cwd: this.app.vault.adapter.basePath,
          timeoutMs: 30000,
        });
        recordProviderResult(this.state.providerStatus, providerId, {
          ok: true,
          message: result.assistantText,
          command: result.command,
        });
      } catch (error) {
        recordProviderResult(this.state.providerStatus, providerId, {
          ok: false,
          message: error && error.message ? error.message : String(error),
        });
      }
    }));
    await this.persist();
    await this.refreshOpenViews();
    new Notice("Agent 检测完成");
  }

  async sendMessageToActiveSession(userInput) {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error("No active session");
    }
    const providerId = session.providerId;
    const provider = this.settings.providers[providerId];
    if (!provider || !provider.enabled) {
      new Notice(`${this.providerLabel(providerId)} 已在设置中停用`);
      return;
    }
    if (this.isSessionRunning(session.id)) {
      new Notice("当前会话仍在运行中");
      return;
    }

    const promptForTitle = userInput.trim();
    const promptSession = {
      ...session,
      messages: [...session.messages],
    };
    upsertMessage(session, { role: "user", content: userInput });
    if (!session.title || session.title.includes("新会话")) {
      session.title = promptForTitle.slice(0, 40);
    }
    if (!this.canRunLocalProviders()) {
      upsertMessage(session, { role: "assistant", content: MOBILE_LOCAL_CLI_MESSAGE });
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message: "手机端记录输入，不运行本地 CLI。",
      });
      await this.persist();
      await this.refreshOpenViews();
      new Notice("已记录输入；执行请回桌面端或派单到任务板");
      return;
    }
    this.running.set(session.id, null);
    markProviderRunning(this.state.providerStatus, providerId);
    await this.persist();
    await this.refreshOpenViews();

    let assistantMessage = null;
    try {
      assistantMessage = upsertMessage(session, { role: "assistant", content: "正在生成…" });
      let streamedText = "";
      let lastStreamRefresh = 0;
      await this.persist();
      await this.refreshOpenViews();

      const result = await runProviderTurn(providerId, promptSession, userInput, this.settings, {
        cwd: this.app.vault.adapter.basePath,
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
      });
      this.running.delete(session.id);
      const assistantText = result.assistantText || streamedText || "(No response text returned)";
      updateMessageContent(session, assistantMessage.id, assistantText);
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: true,
        message: assistantText,
        command: result.command,
      });

      if (this.settings.autoWriteback) {
        this.enqueueWriteback(providerId, session.id, assistantText);
      }

      await this.persist();
      await this.refreshOpenViews();
    } catch (error) {
      this.running.delete(session.id);
      const message = error && error.message ? error.message : String(error);
      if (assistantMessage) {
        updateMessageContent(session, assistantMessage.id, `运行失败：${message}`);
      } else {
        upsertMessage(session, { role: "assistant", content: `运行失败：${message}` });
      }
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message,
      });
      await this.persist();
      await this.refreshOpenViews();
      new Notice(`${this.providerLabel(providerId)} 运行失败：${message}`);
    }
  }
};
