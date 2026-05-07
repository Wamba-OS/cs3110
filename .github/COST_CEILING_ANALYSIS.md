# Cost Ceiling Analysis for Claude Code GitHub Integration

## Pricing Context (as of May 2026)

Claude Sonnet 4.5 via API:
- Input: $3.00 per million tokens
- Output: $15.00 per million tokens

## Expected Token Usage per Security Review

### Input tokens (reading artifacts + code):
- Security artifacts (npm-audit.json, semgrep.sarif, gitleaks.sarif): ~5K tokens
- PR diff (average): ~3K tokens
- System prompt + agent instructions: ~2K tokens
- Context files (if needed): ~5K tokens
**Estimated input per review: ~15K tokens**

### Output tokens (JSON verdict):
- Structured JSON response: ~1-2K tokens
- Comments and explanations: ~1-3K tokens
**Estimated output per review: ~3K tokens**

### Total per review:
- Input: 15K tokens × $3/1M = $0.045
- Output: 3K tokens × $15/1M = $0.045
**Cost per security review: ~$0.09**

## Monthly Volume Estimate

Expected PR activity for this project:
- Development phase: ~10 PRs/month
- Maintenance phase: ~5 PRs/month

**Monthly cost estimate:**
- Development: 10 PRs × $0.09 = **$0.90/month**
- Maintenance: 5 PRs × $0.09 = **$0.45/month**

## Runaway Protection Strategies

### 1. Max Turns Limit (Recommended: 3 turns)

Set in workflow to prevent infinite loops:
```yaml
max_turns: 3
```

This limits the agent to:
- Turn 1: Read artifacts, analyze diff, generate verdict (~15K input + 3K output)
- Turn 2: If needed, read additional context files (~10K input + 2K output)
- Turn 3: Finalize verdict (~5K input + 2K output)

**Worst case per review with 3 turns:**
- Input: 30K tokens × $3/1M = $0.09
- Output: 7K tokens × $15/1M = $0.105
- **Total: ~$0.20 per review**

**Absolute worst case (10 PRs/month, all hitting 3 turns): $2.00/month**

### 2. Token Budget per Invocation

Monitor token usage per workflow run. Set alerts if a single run exceeds:
- 50K input tokens = ~$0.15 input cost
- 10K output tokens = ~$0.15 output cost

### 3. Monthly Budget Alert

Set up Anthropic Console budget alerts:
- **Warning at $5/month** - Review usage patterns
- **Hard limit at $10/month** - Indicates misconfiguration or abuse

### 4. Workflow-level Safety

The claude-review.yml workflow includes:
- `timeout-minutes: 10` - Prevents hung workflows
- `max_turns: 3` - Prevents runaway agent loops
- Runs only on PR events (not on every commit)

## Recommended Settings

For this project in capstone/learning phase:

```yaml
# In .github/workflows/claude-review.yml
timeout-minutes: 10
max_turns: 3
```

And in Anthropic Console:
- Budget alert at $5/month (10× expected usage)
- Review usage quarterly

## Cost Comparison

Traditional security review time:
- Manual security review: 30-60 minutes × $100/hour = **$50-100 per PR**
- Automated with Claude: **$0.09-0.20 per PR**

Even with 3 turns on every PR, the automated approach is ~500× cheaper than manual review, while maintaining consistency and not blocking development velocity.

## Scaling Considerations

If this project scales to 100 PRs/month:
- Expected cost: 100 × $0.09 = $9/month
- Worst case (all 3 turns): 100 × $0.20 = $20/month

Still well within acceptable limits for a production application.

## Decision

**Recommended configuration:**
- `max_turns: 3` (allows thorough analysis without runaway risk)
- `timeout-minutes: 10` (prevents stuck workflows)
- Anthropic Console budget alert: $5/month
- Review usage monthly during development, quarterly in maintenance

**Cost ceiling: $2/month (10 PRs × 3 turns × $0.20)**
**Runaway protection: $10/month hard limit in Anthropic Console**
