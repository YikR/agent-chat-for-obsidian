const { Plugin, ItemView, PluginSettingTab, Setting, Notice, MarkdownView } = require("obsidian");

const { createDefaultState, createSession, upsertMessage } = require("./src/sessionRegistry");
const { DEFAULT_PROVIDER_SETTINGS, runProviderTurn } = require("./src/providers");
const { makeSessionExportPath, renderSessionMarkdown } = require("./src/sessionExport");
const { markProviderRunning, recordProviderResult, summarizeProviderStatus } = require("./src/providerStatus");
const { resolveWritebackTargets } = require("./src/writebackTargets");
const { writebackSessionResult } = require("./src/writeback");

const VIEW_TYPE_AGENT_CHAT = "agent-chat-view";

function cloneProviderSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_PROVIDER_SETTINGS));
}

function createDefaultSettings() {
  return {
    providers: cloneProviderSettings(),
    defaultPlacement: "right",
    autoWriteback: true,
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

    const header = container.createDiv({ cls: "agent-chat-header" });
    const providerSelect = header.createEl("select", { cls: "agent-chat-provider" });
    for (const providerId of Object.keys(this.plugin.settings.providers)) {
      const option = providerSelect.createEl("option", { text: this.plugin.providerLabel(providerId) });
      option.value = providerId;
      option.selected = providerId === session.providerId;
    }
    providerSelect.onchange = async () => {
      this.plugin.setActiveProvider(providerSelect.value);
      await this.render();
    };

    const projectInput = header.createEl("input", {
      cls: "agent-chat-project",
      type: "text",
      placeholder: "绑定项目页路径，例如 02-项目/Obsidian工作流/项目主页.md",
      value: session.projectPath || "",
    });
    projectInput.onchange = async () => {
      this.plugin.setProjectPath(projectInput.value.trim());
      await this.plugin.persist();
    };

    const titleInput = header.createEl("input", {
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

    const bindCurrentButton = header.createEl("button", { text: "绑定当前笔记" });
    bindCurrentButton.onclick = async () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = activeView == null ? void 0 : activeView.file;
      if (!file) {
        new Notice("当前没有活动 Markdown 笔记");
        return;
      }
      this.plugin.setProjectPath(file.path);
      await this.render();
      await this.plugin.persist();
    };

    const newTabButton = header.createEl("button", { text: "新会话" });
    newTabButton.onclick = async () => {
      this.plugin.createTab(session.providerId);
      await this.render();
    };

    const writebackButton = header.createEl("button", { text: "写回" });
    writebackButton.onclick = async () => {
      await this.plugin.writebackActiveSession();
      await this.render();
    };

    const exportButton = header.createEl("button", { text: "导出" });
    exportButton.onclick = async () => {
      await this.plugin.exportActiveSession();
    };

    const stopButton = header.createEl("button", { text: "停止" });
    stopButton.onclick = () => {
      this.plugin.stopActiveRun();
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
      placeholder: "继续推进这个问题…",
    });
    input.onkeydown = async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        send.click();
      }
    };
    const send = footer.createEl("button", { text: "发送" });
    send.onclick = async () => {
      const value = input.value.trim();
      if (!value) {
        return;
      }
      input.value = "";
      await this.plugin.sendMessageToActiveSession(value);
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

    new Setting(containerEl)
      .setName("自动写回")
      .setDesc("每轮对话完成后，把摘要写回对应的 Obsidian 最新页、最近活动页和绑定项目页。")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoWriteback).onChange(async (value) => {
          this.plugin.settings.autoWriteback = value;
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
    this.addSettingTab(new AgentChatSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_CHAT);
  }

  providerLabel(providerId) {
    return (this.settings.providers[providerId] || {}).label || providerId;
  }

  async restore() {
    const saved = (await this.loadData()) || {};
    this.settings = {
      ...createDefaultSettings(),
      ...(saved.settings || {}),
      providers: {
        ...cloneProviderSettings(),
        ...((saved.settings || {}).providers || {}),
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
    const leaf = this.app.workspace.getRightLeaf(false);
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
    const targets = resolveWritebackTargets(session.providerId, session.projectPath);
    session.lastWriteback = await writebackSessionResult(
      this.app,
      session.providerId,
      session,
      lastAssistant.content,
      targets,
    );
    await this.persist();
    new Notice("已写回 Obsidian");
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

    const promptForTitle = userInput.trim();
    const promptSession = {
      ...session,
      messages: [...session.messages],
    };
    upsertMessage(session, { role: "user", content: userInput });
    if (!session.title || session.title.includes("新会话")) {
      session.title = promptForTitle.slice(0, 40);
    }
    await this.persist();

    try {
      markProviderRunning(this.state.providerStatus, providerId);
      await this.persist();
      const result = await runProviderTurn(providerId, promptSession, userInput, this.settings, {
        cwd: this.app.vault.adapter.basePath,
        onSpawn: (child) => {
          this.running.set(session.id, child);
        },
      });
      this.running.delete(session.id);
      const assistantText = result.assistantText;
      upsertMessage(session, { role: "assistant", content: assistantText });
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: true,
        message: assistantText,
        command: result.command,
      });

      if (this.settings.autoWriteback) {
        const targets = resolveWritebackTargets(providerId, session.projectPath);
        session.lastWriteback = await writebackSessionResult(
          this.app,
          providerId,
          session,
          assistantText,
          targets,
        );
      }

      await this.persist();
    } catch (error) {
      this.running.delete(session.id);
      const message = error && error.message ? error.message : String(error);
      upsertMessage(session, { role: "assistant", content: `运行失败：${message}` });
      recordProviderResult(this.state.providerStatus, providerId, {
        ok: false,
        message,
      });
      await this.persist();
      new Notice(`${this.providerLabel(providerId)} 运行失败：${message}`);
    }
  }
};
