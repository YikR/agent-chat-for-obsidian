# Agent Chat for Obsidian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first working Obsidian plugin repository that offers continuous multi-agent chat tabs for Codex, Claude, Hermes, and OpenClaw, with persistent local sessions and Obsidian writeback hooks.

**Architecture:** Use a plain-JavaScript Obsidian plugin to avoid build-chain blockers, keep the UI shell in `main.js`, and move testable logic into focused `src/` modules. Bridge each provider through local CLI execution, persist tab/session state in plugin data, and route post-run writeback into the existing Obsidian workflow pages.

**Tech Stack:** Obsidian desktop plugin API, CommonJS JavaScript, Node built-ins (`child_process`, `fs`, `path`, `node:test`)

---

### Task 1: Repository Scaffold

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `README.md`
- Create: `docs/2026-05-29-implementation-plan.md`

- [x] **Step 1: Create the repository metadata files**
- [x] **Step 2: Keep the plugin plain-JS so local verification does not depend on npm registry installs**

### Task 2: Testable Core Modules

**Files:**
- Create: `src/sessionRegistry.js`
- Create: `src/promptCompiler.js`
- Create: `src/writebackTargets.js`
- Create: `test/core.test.js`

- [ ] **Step 1: Write failing tests for session defaults, history prompt compilation, and writeback routing**
- [ ] **Step 2: Run `npm test` to verify the failures are real**
- [ ] **Step 3: Implement the minimal core modules**
- [ ] **Step 4: Run `npm test` to verify they pass**

### Task 3: Plugin Shell

**Files:**
- Create: `main.js`
- Create: `styles.css`

- [ ] **Step 1: Implement the plugin view, tab shell, provider switcher, and message input**
- [ ] **Step 2: Persist plugin state through `loadData()` / `saveData()`**
- [ ] **Step 3: Wire the shell to the testable core modules**

### Task 4: Provider Adapters and Writeback

**Files:**
- Create: `src/providers.js`
- Modify: `main.js`

- [ ] **Step 1: Add CLI-backed adapters for Codex, Claude, Hermes, and OpenClaw**
- [ ] **Step 2: Add output normalization and recent-history loading**
- [ ] **Step 3: Add Obsidian writeback helpers for latest pages, recent activity, and project notes**
- [ ] **Step 4: Verify the repository state is ready for local install and GitHub push**
