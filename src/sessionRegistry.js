function nowIso() {
  return new Date().toISOString();
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultState() {
  return {
    tabs: [],
    sessions: {},
    activeTabId: null,
    settings: {},
    providerStatus: {},
  };
}

function createSession(input) {
  return {
    id: input.id,
    providerId: input.providerId,
    title: input.title || "New conversation",
    projectPath: input.projectPath || "",
    messages: [],
    lastWriteback: [],
    nativeSessions: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function upsertMessage(session, message) {
  if (!session || !Array.isArray(session.messages)) {
    throw new Error("invalid session");
  }
  const nextMessage = {
    id: message.id || makeMessageId(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || nowIso(),
  };
  session.messages.push(nextMessage);
  session.updatedAt = nowIso();
  return nextMessage;
}

function updateMessageContent(session, messageId, content) {
  if (!session || !Array.isArray(session.messages)) {
    throw new Error("invalid session");
  }
  const message = session.messages.find((item) => item.id === messageId);
  if (!message) {
    return null;
  }
  message.content = content;
  message.updatedAt = nowIso();
  session.updatedAt = nowIso();
  return message;
}

module.exports = {
  createDefaultState,
  createSession,
  updateMessageContent,
  upsertMessage,
};
