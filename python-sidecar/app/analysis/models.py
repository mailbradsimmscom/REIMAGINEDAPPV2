"""
Pydantic models for Test Failure Analysis Agent.

These models define:
1. Input data structures (failures from Supabase)
2. LLM I/O contracts (strict typing for Claude responses)
3. Output structures (analysis results to store)
"""

from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


# =============================================================================
# Input Models - Data from Supabase test_results
# =============================================================================

class FailureRecord(BaseModel):
    """A single test failure from test_results.failures JSONB array."""
    category: str                    # e.g., "integration", "unit", "e2e"
    name: str                        # Test name
    error: Optional[str] = None      # Error message
    file: Optional[str] = None       # Test file path
    fix_hint: Optional[str] = None   # Auto-generated hint from upload script


# =============================================================================
# Historical Analysis Models
# =============================================================================

class HistoricalPattern(BaseModel):
    """
    Historical pass/fail pattern for a specific test.
    Classification is computed deterministically from this data, NOT by LLM.
    """
    window_size: int = Field(
        description="How many recent runs were examined (e.g., 10)"
    )
    total_runs: int = Field(
        description="Total runs found in window"
    )
    total_passes: int
    total_failures: int
    last_pass_run_id: Optional[str] = None
    last_fail_run_id: Optional[str] = None
    first_failure_after_commit: Optional[str] = Field(
        default=None,
        description="Git commit SHA where test started failing (if regression)"
    )
    classification: Literal[
        "always_passes",    # All recent runs passed - shouldn't be failing
        "always_fails",     # All recent runs failed - chronic issue
        "flaky",            # Mix of pass/fail - intermittent
        "recent_regression", # Was passing, now failing
        "new_failure"       # First time seen
    ]


# =============================================================================
# LLM I/O Models - Strict contracts for Claude
# =============================================================================

class LlmHypothesis(BaseModel):
    """
    Structured hypothesis from Claude for fixing a test failure.
    All fields are required to ensure Claude provides complete analysis.
    """
    hypothesis: str = Field(
        description="Clear explanation of what might be causing the failure"
    )
    change_type: Literal[
        "code_change",      # Fix in src/
        "test_change",      # Fix in tests/
        "config_change",    # Environment/config issue
        "no_change"         # No code fix possible (external service, etc.)
    ]
    target_files: list[str] = Field(
        description="Files to modify (must be under src/ or tests/)"
    )
    proposed_diff: Optional[str] = Field(
        default=None,
        description="Unified diff format patch to apply"
    )
    confidence: Literal["low", "medium", "high"]
    tests_to_run: list[str] = Field(
        description="Specific test file paths to run for validation"
    )
    reasoning: str = Field(
        description="Step-by-step reasoning for this hypothesis"
    )


# =============================================================================
# Test Execution Models
# =============================================================================

class TestRunResult(BaseModel):
    """Structured result from running a single test in the sandbox."""
    status: Literal[
        "PASSED",           # exit 0, no timeout
        "FAILED_ASSERTION", # non-zero exit, no timeout
        "TIMED_OUT",        # killed after timeout
        "INFRA_ERROR"       # runner blew up (syntax error, missing file, etc.)
    ]
    exit_code: int
    timed_out: bool
    stdout: str = Field(description="Truncated stdout (max 5000 chars)")
    stderr: str = Field(description="Truncated stderr (max 5000 chars)")
    duration_ms: int


class HypothesisAttempt(BaseModel):
    """Record of testing a single hypothesis."""
    hypothesis: str
    change_type: str
    target_files: list[str]
    proposed_diff: Optional[str] = None
    test_result: Literal["PASSED", "FAILED_ASSERTION", "TIMED_OUT", "INFRA_ERROR", "NOT_RUN"]
    confidence: str
    rejected_reason: Optional[str] = Field(
        default=None,
        description="Why hypothesis was rejected without testing (whitelist, diff too large)"
    )


# =============================================================================
# Output Models - Stored to Supabase test_analysis
# =============================================================================

class Investigation(BaseModel):
    """Details of code investigation phase."""
    files_examined: list[str]
    git_commits_reviewed: list[str]
    pattern_observed: str
    classification_reason: str = Field(
        description="Why the classification was assigned"
    )


class Recommendation(BaseModel):
    """Final recommendation for fixing the failure."""
    type: Literal[
        "code_change",      # Specific code fix identified
        "test_change",      # Test needs fixing
        "config_change",    # Environment/config fix
        "manual_review"     # Human needs to investigate
    ]
    description: str
    files: list[str]
    confidence: Literal["low", "medium", "high"]


class AnalysisResult(BaseModel):
    """
    Complete analysis result for a single test failure.
    Maps directly to test_analysis table columns.
    """
    run_id: str
    failure_key: str                            # "category:test_name"
    classification: Optional[str] = None
    root_cause_type: Optional[str] = None
    investigation: Optional[Investigation] = None
    hypotheses_tested: list[HypothesisAttempt] = Field(default_factory=list)
    recommendation: Optional[Recommendation] = None
    analysis_duration_ms: int
    resolved: bool = False
    human_review_needed: bool = False
    model_used: Optional[str] = None
