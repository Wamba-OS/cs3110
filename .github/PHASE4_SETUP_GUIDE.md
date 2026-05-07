# Phase 4 Setup Guide: Claude Code GitHub Integration

This guide walks you through setting up Claude Code to automatically review PRs for security issues.

## Overview

Once configured, the workflow:
1. Triggers on `@claude` mention in PR comments (Phase 4.4-4.5)
2. Downloads security scan artifacts (npm audit, semgrep, gitleaks)
3. Invokes the `security-reviewer` agent to analyze the PR
4. Posts a structured security verdict as a PR comment
5. Adds `security:pass` or `security:fail` label
6. Later: Auto-triggers on every PR (Phase 4.6)

## Prerequisites

- [ ] Phases 1-3 complete (test framework and security scanning working)
- [ ] GitHub repository with admin access
- [ ] Anthropic API account with billing enabled

---

## Step 1: Install Claude Code GitHub App

**Note:** This step uses the `claude` CLI, not the `claude-code` CLI you've been using in this session.

### 1.1 Install the GitHub App

```bash
# From your local machine (not in this Claude Code session)
claude /install-github-app
```

This will:
- Open your browser to authorize the GitHub App
- Prompt you to select which repositories to install it on
- Select your `cs3110` repository
- Click "Install & Authorize"

### 1.2 Verify Installation

Check that the app is installed:
1. Go to `https://github.com/settings/installations`
2. Find "Claude for GitHub" or "Anthropic Claude"
3. Verify it has access to your repository

---

## Step 2: Add Anthropic API Key to Repository Secrets

### 2.1 Get Your API Key

1. Go to https://console.anthropic.com/
2. Navigate to "API Keys"
3. Create a new key or copy an existing one
4. Save it securely (you won't be able to see it again)

### 2.2 Add to GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: Paste your API key
6. Click **Add secret**

---

## Step 3: Set Budget Alerts (Cost Protection)

### 3.1 In Anthropic Console

1. Go to https://console.anthropic.com/settings/billing
2. Set up budget alerts:
   - **Warning threshold:** $5.00/month
   - **Critical threshold:** $10.00/month
3. Add your email for notifications

### 3.2 Expected Costs

Per the cost analysis in `.github/COST_CEILING_ANALYSIS.md`:
- **Per security review:** ~$0.09 (single turn) to ~$0.20 (3 turns)
- **Expected monthly:** $0.90 (10 PRs) to $2.00 (worst case)
- **Hard ceiling:** $10/month (indicates misconfiguration)

The workflow is configured with:
- `max_turns: 3` - Prevents runaway loops
- `timeout_seconds: 300` - 5 minute timeout
- Runs only on PRs (not every commit)

---

## Step 4: Create GitHub Labels

Create the security labels manually (or they'll be created automatically on first use):

```bash
# Via GitHub CLI
gh label create "security:pass" --color "0E8A16" --description "Security review passed"
gh label create "security:fail" --color "D73A4A" --description "Security review failed"

# Or via web UI:
# Settings → Labels → New label
```

---

## Step 5: Test the Workflow (Phase 4.5)

### 5.1 Push All Phase 4 Changes

```bash
git add .
git commit -m "feat: add Claude Code GitHub integration (Phase 4)"
git push origin main
```

### 5.2 Create a Test PR

```bash
# Create test branch
git checkout -b test/claude-security-review

# Make a trivial change
echo "# Test Claude Security Review" >> TEST.md
git add TEST.md
git commit -m "test: trigger Claude security review"
git push origin test/claude-security-review

# Create PR
gh pr create \
  --title "Test: Claude Security Review" \
  --body "Testing the Claude Code security-reviewer agent integration."
```

### 5.3 Trigger the Security Scan First

The Claude review workflow needs security artifacts. Make sure the security-scan workflow runs first:

1. Wait for security-scan.yml to complete (~2-3 minutes)
2. Verify artifacts were uploaded:
   - Go to Actions → Security Scan run
   - Check for "security-scan-results" artifact

### 5.4 Trigger Claude Review

In the PR, post a comment:
```
@claude please review this PR for security issues
```

This will:
1. Trigger the claude-review.yml workflow
2. Download security artifacts from the security-scan run
3. Invoke the security-reviewer agent
4. Post a structured comment with verdict

### 5.5 Verify the Output

Check that:
- [ ] Workflow completes successfully
- [ ] PR comment appears with security verdict
- [ ] Comment includes:
  - ✅/❌ Verdict (PASS/FAIL)
  - Risk score
  - Summary
  - Findings (if any)
  - Next steps (if issues found)
- [ ] `security:pass` or `security:fail` label added
- [ ] Workflow fails if verdict is FAIL

### 5.6 Review the Agent Output

The security-reviewer agent should:
- Read `npm-audit.json`, `semgrep.sarif`, `gitleaks.sarif`
- Analyze the PR diff
- Return structured JSON verdict
- Provide specific, actionable findings (not generic advice)

### 5.7 Clean Up Test PR

```bash
gh pr close test/claude-security-review --delete-branch
git checkout main
```

---

## Step 6: Enable Auto-Trigger (Phase 4.6)

**Only after successful testing in Step 5!**

### 6.1 Update claude-review.yml

Edit `.github/workflows/claude-review.yml`:

```yaml
# Change from:
on:
  issue_comment:
    types: [created]
  # Uncomment after Phase 4.5 testing is complete:
  # pull_request:
  #   types: [opened, synchronize]

# To:
on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]  # Keep @claude trigger for manual re-runs
```

Also update the `if` condition:

```yaml
# Change from:
if: |
  github.event_name == 'workflow_dispatch' ||
  (github.event_name == 'issue_comment' &&
   github.event.issue.pull_request &&
   contains(github.event.comment.body, '@claude'))

# To:
if: |
  github.event_name == 'workflow_dispatch' ||
  github.event_name == 'pull_request' ||
  (github.event_name == 'issue_comment' &&
   github.event.issue.pull_request &&
   contains(github.event.comment.body, '@claude'))
```

### 6.2 Test Auto-Trigger

Create another test PR - it should automatically trigger both:
1. security-scan.yml (runs first)
2. claude-review.yml (waits for artifacts)

### 6.3 Commit the Change

```bash
git add .github/workflows/claude-review.yml
git commit -m "feat: enable auto-trigger for Claude security reviews"
git push origin main
```

---

## Troubleshooting

### Workflow fails: "ANTHROPIC_API_KEY not found"
- Verify secret is named exactly `ANTHROPIC_API_KEY`
- Check it's a repository secret, not an environment secret
- Ensure workflow has `secrets: inherit` if using environments

### Workflow fails: "Security artifacts not found"
- security-scan.yml must complete first
- Check that security-scan.yml uploaded artifacts successfully
- Try manually triggering security-scan.yml, then claude-review.yml

### Agent returns "FAIL" verdict with no findings
- Check `.security-artifacts/` contents in workflow logs
- Verify SARIF files are valid JSON
- Agent may be unable to parse artifacts - check agent output

### Agent doesn't mention the PR in its response
- Verify `gh` CLI is available in the workflow
- Check that `fetch-depth: 0` is set in checkout step
- PR diff may be too large - agent may need more context

### Cost runaway (>$5 in a day)
- Check Anthropic Console usage dashboard
- Verify `max_turns: 3` is set in workflow
- Check for workflow loops (re-triggering itself)
- Pause the workflow while investigating

### Agent output is not structured JSON
- Agent may be returning error message instead
- Check agent logs in workflow run
- Verify `.claude/agents/security-reviewer.md` is present
- Try manual invocation with `claude` CLI locally

---

## Next Steps After Phase 4

Once Phase 4 is complete and working:

1. Move to **Phase 5**: Create `code-implementer` and `product-manager` subagents
2. Set up **Phase 6**: Branch protection rules requiring `security:pass` label
3. Document the full pipeline for your capstone report

---

## Reference Links

- [Claude Code GitHub Action](https://github.com/anthropics/claude-code-action)
- [Anthropic Console](https://console.anthropic.com/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [SARIF Format Specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)

---

## Checklist

Before moving to Phase 5, verify:

- [x] Claude Code GitHub App installed
- [x] `ANTHROPIC_API_KEY` secret configured
- [x] Budget alerts set in Anthropic Console
- [x] `security:pass` and `security:fail` labels created
- [x] Tested @claude trigger on a real PR
- [x] Verified agent returns structured JSON verdict
- [x] Verified security labels are added correctly
- [x] Auto-trigger enabled and tested
- [x] AGENTIC_SETUP.md Phase 4 marked complete
