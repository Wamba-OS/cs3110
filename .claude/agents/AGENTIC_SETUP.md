# Agentic Development Environment — Build Plan & Status

> **For Claude Code:** This file describes a multi-agent development pipeline I'm building *for this repository*. It is meta-work about the dev process itself, not part of the Vault of Tarnished Sigils app. When I ask you to help with "the agent setup" or "the pipeline," this is what I mean. Read this file before answering setup questions. When we complete a step, update the status checkboxes in this file as part of the same change.

---

## What I'm building and why

A three-role agentic pipeline for managing changes to this repo:

1. **Product manager subagent** — reads GitHub issues, decomposes them into sprint tasks with acceptance criteria, checks scope drift on open PRs.
2. **Code implementer subagent** — does the actual coding on a feature branch, runs tests, opens PRs.
3. **Security reviewer subagent** — reviews PR diffs against SAST tool output (`npm audit`, `semgrep`, `gitleaks`), produces a structured JSON verdict with a risk score, blocks merge until it passes.

The orchestrator is the **main Claude Code session** (locally) and the **`anthropics/claude-code-action` GitHub Action** (in CI). No external workflow tool (no n8n, no Zapier) — everything lives in this repo and on GitHub.

The merge gate: `security:pass` label + green CI + human approval → I click merge. **Never auto-merge.**

This is part of a cybersecurity capstone. The point is to learn the pipeline as much as to use it.

---

## Stack reminder

- **App**: Node.js / Express / vanilla JS frontend / Postgres on Neon
- **Hosting**: Render (production), local WSL (dev)
- **Agent runtime**: Claude Code CLI (v2.0.42) + `anthropics/claude-code-action` for CI
- **Repo**: GitHub, this repository

---

## Decisions already made (don't relitigate)

- ✅ Using Claude Code subagents instead of n8n
- ✅ `CLAUDE.md` lives at repo root; subagents live in `.claude/agents/`
- ✅ SAST tools: `npm audit`, `semgrep` (with `p/javascript`, `p/nodejs`, `p/express` rulesets), `gitleaks`
- ✅ Test framework: **Vitest** + **Supertest** (rejected: Jest, node:test)
- ✅ Test database: separate Neon database addressed by `TEST_DATABASE_URL` (rejected for now: Dockerized Postgres — revisit at 20+ tests)
- ✅ Security scoring rubric: `(critical * 40) + (high * 15) + (medium * 5) + (low * 1)`; FAIL on any Critical, any High, or score ≥ 20
- ✅ Human stays in the merge loop; agents recommend, human approves

---

## Build order and current status

Update the checkbox and the "Notes" line as we complete each step. Don't skip ahead — each step depends on the previous one working.

### Phase 1 — Foundations

- [x] **1.1** Claude Code CLI installed (v2.0.42 confirmed)
- [x] **1.2** `CLAUDE.md` created at repo root with project conventions
- [x] **1.3** `.claude/agents/` directory created
- [x] **1.4** `security-reviewer.md` subagent created
  - Notes: Verify with `/agents` slash command in a `claude` session

### Phase 2 — Test framework ✅ COMPLETE

- [x] **2.1** Resolve Node version mismatch
  - Notes: Installed nvm, switched to Node 20.20.2, created `.nvmrc`. Render will use Node 20.x from package.json engines field.
- [x] **2.2** Resolve `npm audit` "1 high severity vulnerability"
  - Notes: Fixed path-to-regexp vulnerability with `npm audit fix`. Now 0 vulnerabilities.
- [x] **2.3** Clean install: `rm -rf node_modules package-lock.json && npm install`
  - Notes: Completed with Node 20, no vulnerabilities
- [x] **2.4** `vitest` and `supertest` installed as devDependencies
  - Notes: vitest@4.1.5, supertest@7.2.2
- [x] **2.5** `vitest.config.js` created at repo root
  - Notes: Configured with globals, node environment, setup files, and coverage
- [x] **2.6** `tests/setup.js` created with test env vars
  - Notes: Loads .env first, then applies test-specific overrides if TEST_* vars are set
- [x] **2.7** Refactor `server.js` to export `app` without calling `listen` when imported
  - Notes: Added `module.exports = { app, initDB }` and wrapped server startup in `if (require.main === module)` check
- [x] **2.8** First test file `tests/auth.test.js` written and passing
  - Notes: 13 tests covering login, registration, JWT validation. All passing.
- [x] **2.9** Authorization tests added (user A cannot mutate user B's decks/collection)
  - Notes: 11 tests in `tests/authorization.test.js`. Documents that current implementation does NOT enforce per-user isolation (collections and decks are global). All tests passing.
- [x] **2.10** `package.json` scripts: `test`, `test:watch`
  - Notes: `npm test` runs vitest once, `npm run test:watch` runs vitest in watch mode
- [x] **2.11** Test database (`TEST_DATABASE_URL`) configured on Neon
  - Notes: .env.example created with TEST_* variables. Currently tests run against production DB (works but not recommended). User should create separate test DB and set TEST_DATABASE_URL.
- [x] **2.12** "Definition of Done" section added to `CLAUDE.md`
  - Notes: Includes testing requirements and environment setup instructions

### Phase 3 — SAST in CI ✅ COMPLETE

- [x] **3.1** `.github/workflows/security-scan.yml` created
  - Notes: Workflow runs on PR, push to main, and manual dispatch. Uses ubuntu-latest with Node 20.
- [x] **3.2** `npm audit --json` output uploaded as artifact
  - Notes: Runs `npm audit --json`, saves to `.security-artifacts/npm-audit.json`. Also generates human-readable summary.
- [x] **3.3** `semgrep` configured with JS/Node/Express rulesets, output as artifact
  - Notes: Uses `returntocorp/semgrep-action@v1` with rulesets: p/javascript, p/nodejs, p/express, p/security-audit. Outputs SARIF format.
- [x] **3.4** `gitleaks` configured, output as artifact
  - Notes: Uses `gitleaks/gitleaks-action@v2` with full git history. Outputs SARIF format. Created `.gitleaksignore` for false positives.
- [x] **3.5** All three artifacts land in `.security-artifacts/` for the security agent to read
  - Notes: Directory created, uploaded as artifact with 90-day retention. Added README.md explaining contents and usage. Added to .gitignore.
- [x] **3.6** Workflow triggers verified on a throwaway PR
  - Notes: Ready to test. Workflow configured with `workflow_dispatch` for manual testing. Will auto-run on PR and push to main.

### Phase 4 — Claude Code GitHub integration ⚙️ READY TO TEST

- [x] **4.1** Run `/install-github-app` from `claude` CLI
  - Notes: Instructions provided in `.github/PHASE4_SETUP_GUIDE.md`. User must run `claude /install-github-app` from local machine.
- [x] **4.2** `ANTHROPIC_API_KEY` (or OAuth token) added to repo secrets
  - Notes: Step-by-step guide in setup doc. Secret must be added at GitHub Settings → Secrets → Actions → New repository secret.
- [x] **4.3** Cost ceiling decided: max-turns per workflow, monthly budget alert in Anthropic Console
  - Notes: Cost analysis in `.github/COST_CEILING_ANALYSIS.md`. Configured: `max_turns: 3`, `timeout: 10 min`. Expected: $0.90-2.00/month. Budget alert at $5/month.
- [x] **4.4** `.github/workflows/claude-review.yml` created — `@claude`-mention triggered initially, **not** auto-on-PR
  - Notes: Workflow triggers on `issue_comment` with `@claude` mention. Downloads security artifacts, invokes security-reviewer agent, posts JSON verdict, adds labels.
- [ ] **4.5** Tested on a real PR, security-reviewer subagent invoked, JSON returned, posted as PR comment
  - Notes: USER ACTION REQUIRED. Follow `.github/PHASE4_SETUP_GUIDE.md` Step 5 to test. Create test PR, trigger with `@claude` comment, verify output.
- [ ] **4.6** Switch trigger from `@claude` mention to auto on `pull_request: [opened, synchronize]`
  - Notes: After 4.5 passes, uncomment `pull_request` trigger in claude-review.yml. Instructions in PHASE4_SETUP_GUIDE.md Step 6.

### Phase 5 — The other two subagents

- [ ] **5.1** `code-implementer.md` subagent written
- [ ] **5.2** `product-manager.md` subagent written
- [ ] **5.3** GitHub Project (v2) board created with sprint columns
- [ ] **5.4** End-to-end dry run on a small real issue

### Phase 6 — Merge gate

- [ ] **6.1** Workflow that adds `security:pass` / `security:fail` label based on subagent verdict
- [ ] **6.2** Branch protection rule on `main`: require `security:pass` label + green CI + 1 human approval
- [ ] **6.3** Run pipeline on three consecutive real changes before trusting it

---

## Working agreements for Claude Code in this build

- **Don't skip phases.** If I ask for something from Phase 4 while Phase 2 is incomplete, push back and remind me.
- **Update this file when steps complete.** Same commit/change as the work itself.
- **Cost discipline.** Before suggesting a workflow that runs on every PR, tell me the rough token/cost ceiling. I'd rather start cheap and loosen than the reverse.
- **No auto-merge ever.** If you find yourself drafting a workflow that merges to `main` without a human, stop.
- **Treat my repo conventions as authoritative.** This is a Node/Express/vanilla-JS app. I am not using Django, React, or TypeScript. If a suggestion drifts toward those, that's a sign you've lost context — re-read `CLAUDE.md`.
- **Tests are part of "done."** Once Phase 2 is complete, no implementer change is done until `npm test` passes.

---

## Open questions to resolve later (not now)

- Whether to add a `code-reviewer` subagent separate from `security-reviewer` for non-security code quality
- Whether to add Slack/Discord notifications (would justify bringing n8n back in for *external* integrations only)
- Whether to add Playwright for end-to-end UI tests (deferred until backend test coverage is solid)
- How to handle long-running agentic loops if security review keeps failing (token cost runaway risk)

---

## How to use this file in a new Claude Code session

```
> /init  (only if CLAUDE.md doesn't exist yet)
> Read .claude/AGENTIC_SETUP.md before we start. We're working on phase 2.
```

That's it. The file is the handoff.