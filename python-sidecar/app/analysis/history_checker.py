"""
Historical test analysis and deterministic classification.

Queries Supabase for historical test results and computes classification
based on pass/fail patterns. Classification is deterministic, NOT LLM-generated.

Classification Rules:
- always_passes: All recent runs passed (test shouldn't be failing)
- always_fails: All recent runs failed (chronic issue)
- flaky: Mix of pass/fail (>20% each way)
- recent_regression: Was passing, now failing (broke in last few runs)
- new_failure: First time this test appeared in results
"""

import os
from typing import Optional

from supabase import create_client, Client

from .models import HistoricalPattern, FailureRecord


# Default window size for historical analysis
DEFAULT_WINDOW_SIZE = 10
# Threshold for flaky classification (percentage)
FLAKY_THRESHOLD = 0.2


def get_supabase_client() -> Client:
    """Get Supabase client from environment variables."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


def get_failures_for_run(run_id: str) -> list[FailureRecord]:
    """
    Fetch test failures for a specific run.

    Args:
        run_id: UUID of the test run

    Returns:
        List of FailureRecord objects
    """
    client = get_supabase_client()

    result = client.table("test_results").select(
        "failures"
    ).eq("run_id", run_id).execute()

    if not result.data:
        return []

    failures = result.data[0].get("failures", [])
    return [FailureRecord(**f) for f in failures]


def get_historical_pattern(
    failure_key: str,
    current_run_id: str,
    window_size: int = DEFAULT_WINDOW_SIZE
) -> HistoricalPattern:
    """
    Analyze historical pass/fail pattern for a test.

    This function computes classification DETERMINISTICALLY from history.
    The LLM receives this as a FACT, not something to infer.

    Args:
        failure_key: "category:test_name" identifier
        current_run_id: Current run to exclude from history
        window_size: Number of recent runs to examine

    Returns:
        HistoricalPattern with classification
    """
    client = get_supabase_client()
    category, test_name = failure_key.split(":", 1)

    # Fetch recent test results (excluding current run)
    result = client.table("test_results").select(
        "run_id, results, git_commit, created_at"
    ).neq(
        "run_id", current_run_id
    ).order(
        "created_at", desc=True
    ).limit(window_size).execute()

    if not result.data:
        # No history - this is a new failure
        return HistoricalPattern(
            window_size=window_size,
            total_runs=0,
            total_passes=0,
            total_failures=0,
            classification="new_failure"
        )

    # Analyze each run for this specific test
    passes = 0
    failures = 0
    last_pass_run_id: Optional[str] = None
    last_fail_run_id: Optional[str] = None
    first_failure_commit: Optional[str] = None
    run_results: list[tuple[str, bool, str]] = []  # (run_id, passed, commit)

    for row in result.data:
        run_id = row["run_id"]
        results = row.get("results", {})
        git_commit = row.get("git_commit")

        # Look for this test in the results
        category_results = results.get(category, {})
        tests = category_results.get("tests", [])

        test_found = False
        test_passed = False

        for test in tests:
            if test.get("name") == test_name:
                test_found = True
                test_passed = test.get("status") == "passed"
                break

        if test_found:
            run_results.append((run_id, test_passed, git_commit))
            if test_passed:
                passes += 1
                if not last_pass_run_id:
                    last_pass_run_id = run_id
            else:
                failures += 1
                if not last_fail_run_id:
                    last_fail_run_id = run_id
                # Track the commit where it first failed
                first_failure_commit = git_commit

    total_runs = passes + failures

    # Determine classification
    classification = _compute_classification(
        total_runs=total_runs,
        passes=passes,
        failures=failures,
        run_results=run_results
    )

    return HistoricalPattern(
        window_size=window_size,
        total_runs=total_runs,
        total_passes=passes,
        total_failures=failures,
        last_pass_run_id=last_pass_run_id,
        last_fail_run_id=last_fail_run_id,
        first_failure_after_commit=first_failure_commit if classification == "recent_regression" else None,
        classification=classification
    )


def _compute_classification(
    total_runs: int,
    passes: int,
    failures: int,
    run_results: list[tuple[str, bool, str]]
) -> str:
    """
    Compute deterministic classification from pass/fail history.

    Rules applied in order:
    1. No history -> new_failure
    2. All passes -> always_passes (test shouldn't be failing now)
    3. All failures -> always_fails (chronic issue)
    4. Recent pattern of pass->fail -> recent_regression
    5. Mix of pass/fail -> flaky
    """
    if total_runs == 0:
        return "new_failure"

    if failures == 0:
        return "always_passes"

    if passes == 0:
        return "always_fails"

    # Check for recent regression pattern
    # If the last N runs show a transition from passing to failing
    if len(run_results) >= 3:
        recent = run_results[:5]  # Look at 5 most recent
        recent_passes = sum(1 for _, passed, _ in recent if passed)
        recent_failures = sum(1 for _, passed, _ in recent if not passed)

        # Pattern: mostly failing recently, but passed before
        if recent_failures >= 2 and passes > 0:
            # Check if older runs passed
            older = run_results[5:] if len(run_results) > 5 else []
            older_passes = sum(1 for _, passed, _ in older if passed)
            if older_passes > 0 or recent_passes > 0:
                return "recent_regression"

    # Check flaky threshold
    pass_rate = passes / total_runs
    fail_rate = failures / total_runs

    if pass_rate >= FLAKY_THRESHOLD and fail_rate >= FLAKY_THRESHOLD:
        return "flaky"

    # Default to recent_regression if mostly failures
    if fail_rate > 0.5:
        return "recent_regression"

    return "flaky"


def save_analysis_result(
    run_id: str,
    failure_key: str,
    classification: Optional[str],
    root_cause_type: Optional[str],
    investigation: Optional[dict],
    hypotheses_tested: list[dict],
    recommendation: Optional[dict],
    analysis_duration_ms: int,
    resolved: bool,
    human_review_needed: bool,
    model_used: Optional[str]
) -> str:
    """
    Save analysis result to Supabase.

    Args:
        All fields matching test_analysis table columns

    Returns:
        ID of the created record
    """
    client = get_supabase_client()

    result = client.table("test_analysis").upsert({
        "run_id": run_id,
        "failure_key": failure_key,
        "classification": classification,
        "root_cause_type": root_cause_type,
        "investigation": investigation,
        "hypotheses_tested": hypotheses_tested,
        "recommendation": recommendation,
        "analysis_duration_ms": analysis_duration_ms,
        "resolved": resolved,
        "human_review_needed": human_review_needed,
        "model_used": model_used
    }, on_conflict="run_id,failure_key").execute()

    return result.data[0]["id"] if result.data else ""
