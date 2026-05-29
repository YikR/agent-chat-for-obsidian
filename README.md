# Agent Chat for Obsidian

An Obsidian plugin that provides a single chat workspace for:

- Codex
- Claude
- Hermes
- OpenClaw

The plugin is designed for continuous, project-bound conversations that write meaningful results back into an Obsidian-first workflow.

## Repository

- GitHub: `https://github.com/YikR/agent-chat-for-obsidian`

## Current MVP

This repository currently ships a plain-JavaScript Obsidian plugin MVP with:

- a dedicated `Agent Chat` view
- persistent tabs and local session state
- provider switching for `Codex`, `Claude`, `Hermes`, and `OpenClaw`
- CLI-backed turns for each provider
- lightweight writeback into existing Obsidian workflow pages

## Runtime Notes

- The plugin shell and provider adapters are implemented.
- Real provider availability still depends on the local machine where Obsidian runs.
- On the current implementation machine, the first smoke run showed:
  - `Codex`: blocked by local app-server permission initialization
  - `OpenClaw`: blocked by upstream DNS/network resolution in the current environment
  - `Hermes`: no usable assistant text returned in the same environment
  - `Claude`: not yet confirmed from this automation session
- In other words, the MVP chat workspace is installable now, but provider runtime still needs machine-specific verification.

## Local Install

The plugin directory can be symlinked into your vault:

```bash
ln -sfn /Users/yanyunuo/agent-chat-for-obsidian \
  '/Users/yanyunuo/Library/Mobile Documents/iCloud~md~obsidian/Documents/.obsidian/plugins/agent-chat-for-obsidian'
```

Then add `"agent-chat-for-obsidian"` to `.obsidian/community-plugins.json` and reload community plugins in Obsidian.

## Verify

Run the core tests:

```bash
npm test
```

Run syntax checks:

```bash
node --check main.js
node --check src/providers.js
node --check src/writeback.js
```

## Important Security Note

If a GitHub token was pasted into chat during setup, revoke it immediately and create a new one before doing any further GitHub operations.
