"""
Claude LLM integration for test failure analysis.

Uses Anthropic's Claude API with strict Pydantic models for I/O.
Implements guardrails to prevent unsafe operations.

Security:
- Never sends env values, secrets, or API keys to Claude
- Only proposes diffs for whitelisted directories (src/, tests/)
- Enforces diff size limits (<= 50 lines)
"""

import os
from typing import Optional

import anthropic

from .models import LlmHypothesis, HistoricalPattern


# Model to use for analysis
DEFAULT_MODEL = "claude-sonnet-4-20250514"
# Maximum diff lines allowed
MAX_DIFF_LINES = 50
# Whitelisted directories for modifications
ALLOWED_DIRS = ("src/", "tests/")


def get_anthropic_client() -> anthropic.Anthropic:
    """Get Anthropic client from environment."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY must be set")
    return anthropic.Anthropic(api_key=api_key)


def analyze_failure(
    test_name: str,
    test_file_content: str,
    error_message: str,
    classification: str,
    historical_pattern: HistoricalPattern,
    recent_commits: list[dict],
    related_code: Optional[str] = None,
    model: str = DEFAULT_MODEL
) -> LlmHypothesis:
    """
    Use Claude to analyze a test failure and propose a fix.

    Args:
        test_name: Name of the failing test
        test_file_content: Content of the test file
        error_message: Error message from the failure
        classification: Deterministic classification (passed as fact)
        historical_pattern: Historical pass/fail data
        recent_commits: Recent commits that might be relevant
        related_code: Optional related source code
        model: Claude model to use

    Returns:
        LlmHypothesis with structured fix proposal
    """
    client = get_anthropic_client()

    # Build the prompt
    system_prompt = _build_system_prompt()
    user_prompt = _build_user_prompt(
        test_name=test_name,
        test_file_content=test_file_content,
        error_message=error_message,
        classification=classification,
        historical_pattern=historical_pattern,
        recent_commits=recent_commits,
        related_code=related_code
    )

    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}]
    )

    # Parse response into structured hypothesis
    return _parse_response(response.content[0].text)


def _build_system_prompt() -> str:
    """Build the system prompt with guardrails."""
    return """You are a test failure analysis agent. Your job is to:
1. Analyze why a test is failing
2. Propose a specific fix hypothesis
3. Provide a unified diff patch if applicable

CRITICAL RULES:
- You are working in a TEMPORARY SANDBOX. Changes are NOT permanent.
- You can ONLY propose changes to files under: src/ or tests/
- NEVER propose changes to: .env, .github/, sql/, config files
- Keep diffs SMALL (under 50 lines)
- Be PRECISE - include exact file paths and line numbers

CLASSIFICATION CONTEXT:
The test's historical classification is provided as a FACT, not for you to determine.
Use it to guide your analysis:
- "always_passes" -> Something recently broke this test
- "always_fails" -> Chronic issue, may need bigger fix
- "flaky" -> Likely timing/race condition or external service
- "recent_regression" -> Focus on recent commits
- "new_failure" -> New test or new code path

OUTPUT FORMAT:
You must respond with a JSON object containing:
{
  "hypothesis": "Clear explanation of the cause",
  "change_type": "code_change|test_change|config_change|no_change",
  "target_files": ["path/to/file.js"],
  "proposed_diff": "unified diff or null",
  "confidence": "low|medium|high",
  "tests_to_run": ["path/to/test.js"],
  "reasoning": "Step-by-step analysis"
}"""


def _build_user_prompt(
    test_name: str,
    test_file_content: str,
    error_message: str,
    classification: str,
    historical_pattern: HistoricalPattern,
    recent_commits: list[dict],
    related_code: Optional[str]
) -> str:
    """Build the user prompt with all context."""
    commits_text = "\n".join([
        f"  - {c['sha']}: {c['message']} ({c['author']})"
        for c in recent_commits[:5]
    ]) or "  (no recent commits)"

    prompt = f"""Analyze this test failure:

## Test Name
{test_name}

## Classification (FACT - do not change)
{classification}

## Historical Pattern
- Window: {historical_pattern.window_size} runs
- Passes: {historical_pattern.total_passes}
- Failures: {historical_pattern.total_failures}
- First failure commit: {historical_pattern.first_failure_after_commit or 'N/A'}

## Error Message
```
{error_message[:2000]}
```

## Test File Content
```javascript
{test_file_content[:5000]}
```

## Recent Commits
{commits_text}
"""

    if related_code:
        prompt += f"""
## Related Source Code
```javascript
{related_code[:3000]}
```
"""

    prompt += """
Analyze the failure and provide your hypothesis as a JSON object.
Focus on the MOST LIKELY cause given the classification pattern."""

    return prompt


def _parse_response(response_text: str) -> LlmHypothesis:
    """Parse Claude's response into a structured hypothesis."""
    import json

    # Try to extract JSON from the response
    try:
        # Look for JSON block
        if "```json" in response_text:
            json_start = response_text.index("```json") + 7
            json_end = response_text.index("```", json_start)
            json_text = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.index("```") + 3
            json_end = response_text.index("```", json_start)
            json_text = response_text[json_start:json_end].strip()
        elif "{" in response_text:
            # Find the JSON object
            json_start = response_text.index("{")
            json_end = response_text.rindex("}") + 1
            json_text = response_text[json_start:json_end]
        else:
            raise ValueError("No JSON found in response")

        data = json.loads(json_text)
        return LlmHypothesis(**data)

    except (json.JSONDecodeError, ValueError, KeyError) as e:
        # Return a fallback hypothesis
        return LlmHypothesis(
            hypothesis=f"Failed to parse LLM response: {str(e)}",
            change_type="no_change",
            target_files=[],
            proposed_diff=None,
            confidence="low",
            tests_to_run=[],
            reasoning=response_text[:500]
        )


def validate_hypothesis(hypothesis: LlmHypothesis) -> tuple[bool, Optional[str]]:
    """
    Validate a hypothesis against guardrails.

    Args:
        hypothesis: The hypothesis to validate

    Returns:
        Tuple of (is_valid, rejection_reason)
    """
    # Check target files are in allowed directories
    for file_path in hypothesis.target_files:
        if not any(file_path.startswith(d) for d in ALLOWED_DIRS):
            return False, f"File not in allowed directories: {file_path}"

    # Check diff size
    if hypothesis.proposed_diff:
        diff_lines = hypothesis.proposed_diff.count("\n")
        if diff_lines > MAX_DIFF_LINES:
            return False, f"Diff too large: {diff_lines} lines (max {MAX_DIFF_LINES})"

    # Check for dangerous patterns in diff
    if hypothesis.proposed_diff:
        dangerous_patterns = [
            "process.env",
            "ANTHROPIC_API_KEY",
            "SUPABASE_SERVICE_KEY",
            "OPENAI_API_KEY",
            ".env",
        ]
        for pattern in dangerous_patterns:
            if pattern in hypothesis.proposed_diff:
                return False, f"Diff contains dangerous pattern: {pattern}"

    return True, None


def get_model_name() -> str:
    """Get the model name being used."""
    return os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
