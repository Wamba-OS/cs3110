#!/usr/bin/env python3
"""
Automated security review using Claude Code security-reviewer agent.
Reads security artifacts and PR diff, invokes Anthropic API, returns JSON verdict.
"""

import json
import os
import sys
from pathlib import Path
import anthropic

def load_agent_instructions():
    """Load security-reviewer agent instructions from .claude/agents/"""
    agent_path = Path('.claude/agents/security-reviewer.md')
    if not agent_path.exists():
        print("ERROR: security-reviewer.md not found")
        sys.exit(1)

    with open(agent_path, 'r') as f:
        content = f.read()

    # Strip the YAML frontmatter (everything between --- markers)
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            return parts[2].strip()

    return content.strip()

def load_artifacts():
    """Load security scan artifacts from .security-artifacts/"""
    artifacts_dir = Path('.security-artifacts')
    artifacts = {}

    # npm audit
    npm_audit_path = artifacts_dir / 'npm-audit.json'
    if npm_audit_path.exists():
        with open(npm_audit_path, 'r') as f:
            artifacts['npm_audit'] = json.load(f)

    # Semgrep SARIF
    semgrep_path = artifacts_dir / 'semgrep.sarif'
    if semgrep_path.exists():
        with open(semgrep_path, 'r') as f:
            artifacts['semgrep'] = json.load(f)

    # Gitleaks SARIF
    gitleaks_path = artifacts_dir / 'gitleaks.sarif'
    if gitleaks_path.exists():
        with open(gitleaks_path, 'r') as f:
            artifacts['gitleaks'] = json.load(f)

    return artifacts

def get_pr_diff(pr_number, github_token):
    """Get PR diff using GitHub API"""
    import requests

    repo = os.environ.get('GITHUB_REPOSITORY')
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}"

    headers = {
        'Authorization': f'Bearer {github_token}',
        'Accept': 'application/vnd.github.v3.diff'
    }

    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        return f"Error fetching diff: {response.status_code}"

    return response.text

def build_review_prompt(agent_instructions, artifacts, pr_diff, pr_number):
    """Build the complete prompt for Claude"""

    prompt = f"""You are invoked as the security-reviewer agent for PR #{pr_number}.

AGENT INSTRUCTIONS:
{agent_instructions}

SECURITY ARTIFACTS:

npm-audit.json:
```json
{json.dumps(artifacts.get('npm_audit', {}), indent=2)}
```

semgrep.sarif:
```json
{json.dumps(artifacts.get('semgrep', {}), indent=2)}
```

gitleaks.sarif:
```json
{json.dumps(artifacts.get('gitleaks', {}), indent=2)}
```

PR DIFF:
```diff
{pr_diff[:10000]}
```

TASK:
Review this PR for security issues following your agent instructions.
Return ONLY the JSON verdict as specified in your instructions.
Do not include any other text before or after the JSON.
"""

    return prompt

def invoke_claude(prompt, api_key):
    """Invoke Claude via Anthropic API"""
    client = anthropic.Anthropic(api_key=api_key)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        temperature=0,
        system="You are a senior application security engineer. You review code for security vulnerabilities and return structured JSON verdicts.",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    )

    return response.content[0].text

def extract_json_verdict(response_text):
    """Extract JSON verdict from Claude's response"""
    # Try to find JSON in markdown code fence
    if '```json' in response_text:
        start = response_text.find('```json') + 7
        end = response_text.find('```', start)
        json_str = response_text[start:end].strip()
    elif '```' in response_text:
        start = response_text.find('```') + 3
        end = response_text.find('```', start)
        json_str = response_text[start:end].strip()
    else:
        # Try to find JSON object directly
        start = response_text.find('{')
        end = response_text.rfind('}') + 1
        if start >= 0 and end > start:
            json_str = response_text[start:end]
        else:
            json_str = response_text

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse JSON: {e}")
        print(f"Response text: {response_text[:500]}")
        # Return a FAIL verdict
        return {
            "verdict": "FAIL",
            "risk_score": 100,
            "summary": "Security review failed - could not parse agent response",
            "findings": [{
                "severity": "High",
                "title": "Security review parsing error",
                "file": "N/A",
                "line": None,
                "cwe": None,
                "source": "manual-review",
                "explanation": f"Failed to parse security-reviewer response: {str(e)}",
                "suggested_fix": "Re-run the security review"
            }],
            "next_steps_for_implementer": ["Fix the security-reviewer agent prompt"]
        }

def main():
    # Get environment variables
    anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
    github_token = os.environ.get('GITHUB_TOKEN')
    pr_number = os.environ.get('PR_NUMBER')

    if not anthropic_api_key:
        print("ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    if not pr_number:
        print("ERROR: PR_NUMBER not set")
        sys.exit(1)

    print("Loading security-reviewer agent instructions...")
    agent_instructions = load_agent_instructions()

    print("Loading security artifacts...")
    artifacts = load_artifacts()

    print(f"Fetching PR #{pr_number} diff...")
    pr_diff = get_pr_diff(pr_number, github_token)

    print("Building review prompt...")
    prompt = build_review_prompt(agent_instructions, artifacts, pr_diff, pr_number)

    print(f"Invoking Claude Sonnet (prompt length: {len(prompt)} chars)...")
    response = invoke_claude(prompt, anthropic_api_key)

    print("Parsing JSON verdict...")
    verdict = extract_json_verdict(response)

    # Output verdict as JSON to stdout (will be captured by workflow)
    print("\n=== VERDICT ===")
    print(json.dumps(verdict, indent=2))

    # Write to file for workflow to read
    with open('verdict.json', 'w') as f:
        json.dump(verdict, f, indent=2)

    print(f"\nVerdict: {verdict['verdict']}")
    print(f"Risk Score: {verdict['risk_score']}")

    # Exit with error code if FAIL
    if verdict['verdict'] == 'FAIL':
        sys.exit(1)

    sys.exit(0)

if __name__ == '__main__':
    main()
