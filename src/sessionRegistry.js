function nowIso() {
  return new Date().toISOString();
}

function createDefaultState() {
  return {
    tabs: [],
    sessions: {},
    activeTabId: null,
    settings: {},
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
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function upsertMessage(session, message) {
  if (!session || !Array.isArray(session.messages)) {
    throw new Error("invalid session");
  }
  session.messages.push({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || nowIso(),
  });
  session.updatedAt = nowIso();
  return session;
}

module.exports = {
  createDefaultState,
  createSession,
  upsertMessage,
};
