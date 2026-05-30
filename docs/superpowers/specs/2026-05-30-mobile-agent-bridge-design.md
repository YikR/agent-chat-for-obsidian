# Mobile Agent Bridge Design

## Goal

Let Obsidian mobile use Agent Chat as an execution client by sending requests to a desktop Mac bridge process that already has access to local `codex`, `claude`, `hermes`, and `openclaw` CLIs.

The first version is intentionally LAN-first. It should make phone-to-Mac execution work on trusted local networks without introducing public hosting, reverse proxies, or model/API secrets on the phone.

## Non-Goals

- No public internet relay in the first version.
- No storage of model API keys, GitHub tokens, cookies, or agent auth material in the mobile plugin.
- No browser-based OAuth or external account system.
- No replacement for the existing Hermes scheduler or Obsidian task-board dispatch flow.
- No always-on macOS LaunchAgent setup in the first implementation; provide a manual bridge start command first.

## Current State

Agent Chat already supports Obsidian mobile loading because `manifest.json` sets `isDesktopOnly` to `false`.

On mobile, the plugin currently acts as a workbench only:

- It can view and edit local plugin sessions synced through the vault.
- It can write back, export, bind project pages, and dispatch to the Agent task board.
- It cannot run local CLI providers because Obsidian mobile cannot spawn macOS CLI processes.

Desktop execution already works through `src/providers.js`, which builds provider-specific spawn specs and runs local commands through Node child processes.

## Recommended Approach

Add a separate desktop bridge process plus a mobile-aware remote transport.

The bridge runs on the desktop Mac and exposes a small HTTP API. The mobile plugin sends provider turns to the bridge. The bridge reuses the existing provider adapter code to run the selected local CLI from the Mac, then returns the assistant text and command metadata.

This keeps all high-risk execution and credentials on the Mac while making the mobile plugin a thin client.

## Architecture

### Components

1. `scripts/agent-chat-bridge.js`
   - Starts a local HTTP server.
   - Loads bridge config from a JSON file.
   - Accepts authenticated provider execution requests.
   - Calls existing provider execution logic from `src/providers.js`.
   - Returns normalized assistant text and provider status.

2. `src/bridgeClient.js`
   - Builds authenticated HTTP requests for mobile remote execution.
   - Handles connection, timeout, invalid token, invalid provider, and malformed response errors.
   - Keeps the mobile plugin independent from Node-only server internals.

3. `main.js`
   - Adds remote bridge settings.
   - Uses the bridge when running on mobile and remote execution is enabled.
   - Keeps current desktop local CLI behavior unchanged.
   - Preserves the current mobile fallback when no bridge is configured.

4. `test/core.test.js`
   - Covers bridge request/response shape.
   - Covers mobile remote routing decisions.
   - Covers security and error cases without needing real agent CLIs.

### Data Flow

1. User sends a message in Obsidian mobile.
2. Plugin records the user message in the local session immediately.
3. If mobile bridge mode is enabled, plugin sends a `POST /v1/turn` request to the desktop bridge.
4. Bridge validates token and provider.
5. Bridge calls `runProviderTurn(providerId, session, userInput, settings, options)`.
6. Bridge returns assistant text, command summary, provider status, and optional native session metadata.
7. Mobile plugin appends the assistant message.
8. Existing writeback queue handles Obsidian writes.

## HTTP API

### Health

`GET /v1/health`

Response:

```json
{
  "ok": true,
  "name": "agent-chat-bridge",
  "version": "0.1.0",
  "providers": ["codex", "claude", "hermes", "openclaw"]
}
```

### Run Turn

`POST /v1/turn`

Headers:

```http
Authorization: Bearer <bridge-token>
Content-Type: application/json
```

Request:

```json
{
  "providerId": "codex",
  "session": {
    "id": "session-123",
    "providerId": "codex",
    "title": "Mobile follow-up",
    "projectPath": "02-项目/Obsidian工作流/项目主页.md",
    "messages": []
  },
  "userInput": "继续推进这个任务",
  "settings": {
    "providers": {
      "codex": {
        "enabled": true,
        "cliPath": "codex",
        "cwd": "/Users/yanyunuo",
        "timeoutMs": 600000,
        "extraArgs": "",
        "nativeResume": true,
        "permissionMode": "danger-full-access"
      }
    }
  }
}
```

Response:

```json
{
  "ok": true,
  "assistantText": "执行结果正文",
  "command": "codex exec ...",
  "providerId": "codex"
}
```

Error response:

```json
{
  "ok": false,
  "error": "Unauthorized"
}
```

## Bridge Config

Default config path:

`~/.agent-chat-bridge/config.json`

Example:

```json
{
  "host": "127.0.0.1",
  "port": 3876,
  "token": "replace-with-random-token",
  "allowedProviders": ["codex", "claude", "hermes", "openclaw"],
  "defaultCwd": "/Users/yanyunuo"
}
```

For real phone access, the user can set `host` to the Mac LAN IP after confirming the network is trusted. The README must state that `127.0.0.1` only works from the Mac itself, not from the phone.

## Plugin Settings

Add a `remoteBridge` setting group:

```json
{
  "enabled": false,
  "url": "http://127.0.0.1:3876",
  "token": "",
  "timeoutMs": 600000
}
```

Mobile behavior:

- If `remoteBridge.enabled` is `false`, keep the existing mobile message: record input but do not execute.
- If enabled and configured, send the provider turn to the bridge.
- If the bridge call fails, append a clear assistant error message and keep the user input in the session.

Desktop behavior:

- Continue using local CLI execution by default.
- Do not route desktop traffic through the bridge unless a future setting explicitly opts in.

## Security Rules

- Token is required for all non-health execution endpoints.
- Bridge rejects unknown provider IDs.
- Bridge only allows providers listed in `allowedProviders`.
- Bridge never returns raw environment variables.
- Bridge should return a command summary for debugging but should not include auth tokens.
- Mobile plugin should mask the token in settings UI.
- README must warn that exposing the bridge to the public internet is unsupported in the first version.

## Error Handling

Use these user-visible error categories:

- Bridge not configured: mobile keeps current local-CLI unavailable message.
- Network unreachable: show that the phone cannot reach the desktop bridge URL.
- Unauthorized: show that the bridge token is wrong.
- Provider disabled: show that the selected agent is disabled in plugin settings.
- Provider execution failed: show the sanitized CLI error text.
- Timeout: show the configured timeout and suggest checking the desktop bridge process.

## Testing Strategy

Automated tests should cover:

- Bridge client sends `Authorization: Bearer <token>`.
- Bridge client rejects failed responses with readable errors.
- Bridge server rejects missing token.
- Bridge server rejects unknown provider IDs.
- Bridge server can execute through an injected fake provider runner.
- Mobile routing uses remote bridge when enabled.
- Mobile routing keeps existing no-local-CLI message when remote bridge is disabled.

Manual verification should cover:

- Desktop Obsidian still runs local CLI providers normally.
- Mobile-emulated Obsidian does not expose local CLI detection.
- Bridge health endpoint returns JSON.
- A phone on the same LAN can reach the Mac bridge URL.
- A mobile plugin turn through the bridge writes the assistant response into the same session.

## Release Plan

Ship as `v0.7.0` because this adds a new execution transport.

Release artifacts stay the same:

- `main.js`
- `manifest.json`
- `styles.css`

The bridge script is source-controlled and documented, but Obsidian BRAT release assets do not need to include it unless the build script is extended. Desktop users can run it from the cloned repo in the first version.

## Open Decisions

These are fixed for the first implementation:

- Transport: HTTP JSON.
- Scope: LAN-first desktop bridge.
- Auth: static bearer token.
- Desktop default: local CLI, not bridge.
- Mobile default: no remote execution until the user enables and configures bridge settings.
