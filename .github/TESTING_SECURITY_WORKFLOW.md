# Testing the Security Scan Workflow

This guide explains how to test the security-scan.yml workflow.

## Prerequisites

1. All Phase 2 and Phase 3 changes must be committed and pushed to GitHub
2. GitHub Actions must be enabled for your repository

## Method 1: Manual Trigger (Recommended for First Test)

The workflow includes `workflow_dispatch` which allows manual triggering:

1. Push all changes to main branch:
   ```bash
   git add .
   git commit -m "feat: add Phase 2 test framework and Phase 3 security scanning"
   git push origin main
   ```

2. Go to GitHub: `https://github.com/YOUR_USERNAME/YOUR_REPO/actions`
3. Click "Security Scan (SAST)" in the left sidebar
4. Click "Run workflow" dropdown
5. Select branch `main`
6. Click "Run workflow" button
7. Wait for workflow to complete (~2-3 minutes)
8. Review the workflow run and download artifacts

## Method 2: Test via Pull Request (Recommended for Full Test)

Create a throwaway branch and PR to test the full workflow:

```bash
# Create a test branch
git checkout -b test/security-workflow

# Make a trivial change (e.g., update TESTING_SECURITY_WORKFLOW.md)
echo "" >> .github/TESTING_SECURITY_WORKFLOW.md
git add .github/TESTING_SECURITY_WORKFLOW.md
git commit -m "test: trigger security workflow"

# Push to GitHub
git push origin test/security-workflow

# Create PR via GitHub web UI or gh CLI:
gh pr create --title "Test: Security Workflow" --body "Testing automated security scanning"
```

The workflow will:
1. Run automatically on PR creation
2. Post a security summary comment to the PR
3. Upload artifacts to the workflow run

After verification:
```bash
# Close and delete the test PR
gh pr close --delete-branch

# Return to main
git checkout main
```

## Method 3: Automatic Trigger on Push to Main

Any push to the main branch will automatically trigger the security scan.

## Verifying the Workflow

### Check the Workflow Run

1. Navigate to Actions tab
2. Click on the workflow run
3. Verify all steps completed successfully:
   - ✅ Checkout code
   - ✅ Set up Node.js 20
   - ✅ Run npm audit
   - ✅ Run Semgrep
   - ✅ Run Gitleaks
   - ✅ Upload security artifacts

### Check the Artifacts

1. Scroll to bottom of workflow run page
2. Click "security-scan-results" artifact
3. Download and extract the ZIP file
4. Verify files exist:
   - `npm-audit.json`
   - `npm-audit-summary.txt`
   - `semgrep.sarif` (or semgrep-summary.json)
   - `gitleaks.sarif` (or gitleaks-summary.json)
   - `SUMMARY.md`

### Check PR Comment (Method 2 only)

If testing via PR, the workflow should post a comment with:
- Scan date and commit SHA
- npm audit results summary
- Semgrep findings count
- Gitleaks findings count

## Expected Results for Current Codebase

Based on current state:

- **npm audit**: 0 vulnerabilities (we fixed path-to-regexp in Phase 2)
- **Semgrep**: May find some low-severity findings (e.g., missing input validation)
- **Gitleaks**: Should be 0 secrets (all sensitive data in .env which is gitignored)

## Troubleshooting

### Workflow fails on "Run Semgrep"
- This is expected if using free tier (rate limits)
- Check the Semgrep step logs for details
- May need to configure `SEMGREP_APP_TOKEN` secret for higher limits

### Workflow fails on "Run Gitleaks"
- Check if repository has public visibility
- Gitleaks action is free for public repos
- For private repos, may need `GITLEAKS_LICENSE` secret

### Artifacts not uploading
- Check `actions/upload-artifact@v4` step logs
- Verify `.security-artifacts/` directory was created
- Check file permissions

## Next Steps After Successful Test

Once the workflow runs successfully:

1. Mark Phase 3 task 3.6 as complete in AGENTIC_SETUP.md
2. Proceed to Phase 4: Claude Code GitHub integration
3. Consider adding this workflow as a required status check for PRs

## Cost Considerations

- npm audit: Free
- Semgrep: Free tier allows 10 scans/day, upgrade for unlimited
- Gitleaks: Free for public repos
- GitHub Actions minutes: Free tier includes 2,000 minutes/month
- Estimated cost per workflow run: ~2-3 minutes

For this repository with expected low PR volume:
- ~20 PR scans/month = 40-60 minutes
- Well within free tier limits
