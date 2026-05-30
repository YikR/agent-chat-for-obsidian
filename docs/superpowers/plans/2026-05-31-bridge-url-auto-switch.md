# Bridge URL Auto Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ordered Bridge URL candidates and automatic fallback for health checks and mobile execution.

**Architecture:** `src/bridgeClient.js` owns candidate normalization and fallback request behavior. `src/turnTransport.js` preserves transport routing and returns the selected Bridge URL. `main.js` persists the selected URL after a successful mobile health check or turn.

**Tech Stack:** Obsidian plugin JavaScript, Node test runner, existing npm build script.

---

### Task 1: Candidate URLs and Turn Fallback

**Files:**
- Modify: `src/bridgeClient.js`
- Modify: `test/core.test.js`

- [ ] Write failing tests for candidate URL de-duplication and fallback turn execution.
- [ ] Run `node --test test/core.test.js` and confirm the new tests fail.
- [ ] Add `getBridgeCandidateUrls()` and update `requestBridgeTurn()` to try each candidate in order.
- [ ] Return `selectedUrl` from successful Bridge turn calls.
- [ ] Re-run `node --test test/core.test.js`.

### Task 2: Health Check Fallback and Persistence

**Files:**
- Modify: `main.js`
- Modify: `src/turnTransport.js`
- Modify: `test/core.test.js`

- [ ] Write failing tests that mobile runtime surfaces the selected Bridge URL.
- [ ] Add selected URL propagation through `runTurnForRuntime()`.
- [ ] Update mobile send flow to save the successful URL as `remoteBridge.url`.
- [ ] Update Bridge health check to try candidate URLs on mobile and save the successful candidate.
- [ ] Keep desktop health check pinned to `127.0.0.1:<port>`.

### Task 3: Settings, Docs, Build, and Local Install

**Files:**
- Modify: `main.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `manifest.json`

- [ ] Add a settings textarea for ordered Bridge candidate URLs.
- [ ] Bump version to the next patch release.
- [ ] Run `npm test`.
- [ ] Run `node --check main.js` and `node --check dist/main.js`.
- [ ] Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into the local Obsidian plugin directory.
