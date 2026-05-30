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
