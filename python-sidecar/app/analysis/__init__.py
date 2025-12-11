"""
Test Failure Analysis Agent

AI-powered analysis of test failures that:
1. Parses test failures from CI runs
2. Computes deterministic classification from history
3. Uses Claude to investigate code and propose fixes
4. Tests hypotheses in isolated git worktree sandbox
5. Reports structured findings to Supabase

Usage:
    python scripts/analyze-failures.py --run-id <uuid>
"""

from .models import (
    FailureRecord,
    HistoricalPattern,
    LlmHypothesis,
    TestRunResult,
    AnalysisResult,
)
from .worktree import agent_worktree, WorktreeError

__all__ = [
    "FailureRecord",
    "HistoricalPattern",
    "LlmHypothesis",
    "TestRunResult",
    "AnalysisResult",
    "agent_worktree",
    "WorktreeError",
]
