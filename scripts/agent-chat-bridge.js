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
