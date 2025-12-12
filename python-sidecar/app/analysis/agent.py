"""
Main Test Failure Analysis Agent.

Orchestrates the 5-phase analysis workflow:
1. Parse & Understand - Fetch failures, read test files
2. Compare & Contextualize - Get history, compute classification
3. Investigate Code - Read related code, get git history
4. Test Hypotheses - Use Claude, apply patches, run tests
5. Report - Store results to Supabase

This agent runs in GitHub Actions after tests complete.
"""

import time
from pathlib import Path
from typing import Optional

from .models import (
    FailureRecord,
    HistoricalPattern,
    HypothesisAttempt,
    Investigation,
    Recommendation,
    AnalysisResult,
)
from .worktree import agent_worktree
from .file_reader import (
    read_file,
    find_test_file,
    get_recent_commits,
)
from .history_checker import (
    get_failures_for_run,
    get_historical_pattern,
    save_analysis_result,
)
from .llm_analyzer import (
    analyze_failure,
    validate_hypothesis,
    get_model_name,
)
from .test_runner import run_test_with_patch


# Configuration
MAX_FAILURES = 10
MAX_HYPOTHESES_PER_FAILURE = 3
TOTAL_TIMEOUT_MS = 15 * 60 * 1000  # 15 minutes


class AnalysisAgent:
    """Main agent for analyzing test failures."""

    def __init__(
        self,
        repo_root: Path,
        run_id: str,
        max_failures: int = MAX_FAILURES,
        max_hypotheses: int = MAX_HYPOTHESES_PER_FAILURE,
        dry_run: bool = False
    ):
        self.repo_root = Path(repo_root).resolve()
        self.run_id = run_id
        self.max_failures = max_failures
        self.max_hypotheses = max_hypotheses
        self.dry_run = dry_run
        self.start_time = time.time()

    def run(self) -> list[AnalysisResult]:
        """
        Run the full analysis pipeline.

        Returns:
            List of AnalysisResult for each failure analyzed
        """
        print(f"Starting analysis for run {self.run_id}")
        print(f"  Max failures: {self.max_failures}")
        print(f"  Max hypotheses per failure: {self.max_hypotheses}")
        print(f"  Dry run: {self.dry_run}")

        # Phase 1: Fetch failures
        failures = get_failures_for_run(self.run_id)
        print(f"  Found {len(failures)} failures")

        if not failures:
            print("No failures to analyze")
            return []

        # Limit failures
        failures = failures[:self.max_failures]

        results = []

        # Use git worktree for sandbox operations
        with agent_worktree(self.repo_root) as sandbox_path:
            print(f"  Created sandbox at {sandbox_path}")

            for failure in failures:
                if self._is_timeout():
                    print("  Time limit reached, stopping analysis")
                    break

                result = self._analyze_single_failure(failure, sandbox_path)
                results.append(result)

                # Save to database
                if not self.dry_run:
                    self._save_result(result)

        print(f"\nAnalysis complete: {len(results)} failures analyzed")
        return results

    def _analyze_single_failure(
        self,
        failure: FailureRecord,
        sandbox_path: Path
    ) -> AnalysisResult:
        """Analyze a single test failure through all phases."""
        start_time = time.time()
        failure_key = f"{failure.category}:{failure.name}"
        print(f"\n  Analyzing: {failure_key}")

        # Phase 2: Get historical pattern and classification
        pattern = get_historical_pattern(failure_key, self.run_id)
        print(f"    Classification: {pattern.classification}")

        # Phase 3: Investigate code
        investigation = self._investigate_code(failure, pattern)

        # Phase 4: Test hypotheses (skip in dry run)
        hypotheses_tested: list[HypothesisAttempt] = []
        resolved = False
        recommendation: Optional[Recommendation] = None

        if not self.dry_run:
            hypotheses_tested, resolved, recommendation = self._test_hypotheses(
                failure=failure,
                pattern=pattern,
                investigation=investigation,
                sandbox_path=sandbox_path
            )

        duration_ms = int((time.time() - start_time) * 1000)

        # Determine if human review is needed
        human_review_needed = not resolved and len(hypotheses_tested) >= self.max_hypotheses

        return AnalysisResult(
            run_id=self.run_id,
            failure_key=failure_key,
            classification=pattern.classification,
            root_cause_type=recommendation.type if recommendation else None,
            investigation=investigation,
            hypotheses_tested=hypotheses_tested,
            recommendation=recommendation,
            analysis_duration_ms=duration_ms,
            resolved=resolved,
            human_review_needed=human_review_needed,
            model_used=get_model_name() if not self.dry_run else None
        )

    def _investigate_code(
        self,
        failure: FailureRecord,
        pattern: HistoricalPattern
    ) -> Investigation:
        """Phase 3: Investigate the code related to the failure."""
        files_examined = []
        commits_reviewed = []

        # Find and read the test file
        test_file = find_test_file(self.repo_root, failure.name, failure.category)
        if test_file:
            files_examined.append(test_file)

        # Get recent commits
        commits = get_recent_commits(self.repo_root, test_file, limit=5)
        commits_reviewed = [c["sha"] for c in commits]

        # Build pattern observation
        if pattern.classification == "always_passes":
            pattern_observed = "Test was consistently passing, this is a new failure"
        elif pattern.classification == "always_fails":
            pattern_observed = "Test has been failing consistently across all recent runs"
        elif pattern.classification == "flaky":
            pattern_observed = f"Test is flaky: {pattern.total_passes}/{pattern.total_runs} passes"
        elif pattern.classification == "recent_regression":
            pattern_observed = f"Test started failing after commit {pattern.first_failure_after_commit}"
        else:
            pattern_observed = "This is the first time this test has been seen"

        return Investigation(
            files_examined=files_examined,
            git_commits_reviewed=commits_reviewed,
            pattern_observed=pattern_observed,
            classification_reason=f"Based on {pattern.window_size} run window: "
                                  f"{pattern.total_passes} passes, {pattern.total_failures} failures"
        )

    def _test_hypotheses(
        self,
        failure: FailureRecord,
        pattern: HistoricalPattern,
        investigation: Investigation,
        sandbox_path: Path
    ) -> tuple[list[HypothesisAttempt], bool, Optional[Recommendation]]:
        """Phase 4: Generate and test hypotheses using Claude."""
        hypotheses_tested = []
        resolved = False
        final_recommendation: Optional[Recommendation] = None

        # Read test file content for Claude
        test_file = investigation.files_examined[0] if investigation.files_examined else None
        test_content = read_file(self.repo_root, test_file) if test_file else ""
        error_message = failure.error or ""

        # Get recent commits
        commits = get_recent_commits(self.repo_root, test_file, limit=5)

        for attempt_num in range(self.max_hypotheses):
            if self._is_timeout():
                break

            print(f"    Hypothesis {attempt_num + 1}/{self.max_hypotheses}")

            # Ask Claude for a hypothesis
            try:
                hypothesis = analyze_failure(
                    test_name=failure.name,
                    test_file_content=test_content,
                    error_message=error_message,
                    classification=pattern.classification,
                    historical_pattern=pattern,
                    recent_commits=commits
                )
            except Exception as e:
                import traceback
                print(f"      LLM error: {e}")
                print(f"      Error type: {type(e).__name__}")
                print(f"      Traceback: {traceback.format_exc()}")
                hypotheses_tested.append(HypothesisAttempt(
                    hypothesis=f"LLM call failed: {str(e)}",
                    change_type="no_change",
                    target_files=[],
                    test_result="NOT_RUN",
                    confidence="low",
                    rejected_reason=str(e)
                ))
                continue

            # Validate hypothesis against guardrails
            is_valid, rejection_reason = validate_hypothesis(hypothesis)

            if not is_valid:
                print(f"      Rejected: {rejection_reason}")
                hypotheses_tested.append(HypothesisAttempt(
                    hypothesis=hypothesis.hypothesis,
                    change_type=hypothesis.change_type,
                    target_files=hypothesis.target_files,
                    proposed_diff=hypothesis.proposed_diff,
                    test_result="NOT_RUN",
                    confidence=hypothesis.confidence,
                    rejected_reason=rejection_reason
                ))
                continue

            # Run test with proposed fix
            test_to_run = hypothesis.tests_to_run[0] if hypothesis.tests_to_run else test_file
            if test_to_run:
                result = run_test_with_patch(
                    sandbox_path=sandbox_path,
                    test_file=test_to_run,
                    diff_content=hypothesis.proposed_diff,
                    test_name=failure.name
                )

                hypotheses_tested.append(HypothesisAttempt(
                    hypothesis=hypothesis.hypothesis,
                    change_type=hypothesis.change_type,
                    target_files=hypothesis.target_files,
                    proposed_diff=hypothesis.proposed_diff,
                    test_result=result.status,
                    confidence=hypothesis.confidence
                ))

                print(f"      Result: {result.status}")

                if result.status == "PASSED":
                    resolved = True
                    final_recommendation = Recommendation(
                        type=hypothesis.change_type,
                        description=hypothesis.hypothesis,
                        files=hypothesis.target_files,
                        confidence=hypothesis.confidence
                    )
                    break
            else:
                hypotheses_tested.append(HypothesisAttempt(
                    hypothesis=hypothesis.hypothesis,
                    change_type=hypothesis.change_type,
                    target_files=hypothesis.target_files,
                    proposed_diff=hypothesis.proposed_diff,
                    test_result="NOT_RUN",
                    confidence=hypothesis.confidence,
                    rejected_reason="No test file to run"
                ))

        # If not resolved, create a manual review recommendation
        if not resolved and hypotheses_tested:
            best_hypothesis = max(
                hypotheses_tested,
                key=lambda h: {"high": 3, "medium": 2, "low": 1}.get(h.confidence, 0)
            )
            final_recommendation = Recommendation(
                type="manual_review",
                description=f"Automated fixes unsuccessful. Best hypothesis: {best_hypothesis.hypothesis}",
                files=best_hypothesis.target_files,
                confidence="low"
            )

        return hypotheses_tested, resolved, final_recommendation

    def _save_result(self, result: AnalysisResult) -> None:
        """Save analysis result to Supabase."""
        save_analysis_result(
            run_id=result.run_id,
            failure_key=result.failure_key,
            classification=result.classification,
            root_cause_type=result.root_cause_type,
            investigation=result.investigation.model_dump() if result.investigation else None,
            hypotheses_tested=[h.model_dump() for h in result.hypotheses_tested],
            recommendation=result.recommendation.model_dump() if result.recommendation else None,
            analysis_duration_ms=result.analysis_duration_ms,
            resolved=result.resolved,
            human_review_needed=result.human_review_needed,
            model_used=result.model_used
        )

    def _is_timeout(self) -> bool:
        """Check if we've exceeded the total time limit."""
        elapsed_ms = (time.time() - self.start_time) * 1000
        return elapsed_ms >= TOTAL_TIMEOUT_MS


def run_analysis(
    repo_root: Path,
    run_id: str,
    max_failures: int = MAX_FAILURES,
    max_hypotheses: int = MAX_HYPOTHESES_PER_FAILURE,
    dry_run: bool = False
) -> list[AnalysisResult]:
    """
    Convenience function to run the analysis agent.

    Args:
        repo_root: Path to the git repository
        run_id: UUID of the test run to analyze
        max_failures: Maximum failures to analyze
        max_hypotheses: Maximum hypotheses per failure
        dry_run: If True, skip LLM calls and database writes

    Returns:
        List of AnalysisResult objects
    """
    agent = AnalysisAgent(
        repo_root=repo_root,
        run_id=run_id,
        max_failures=max_failures,
        max_hypotheses=max_hypotheses,
        dry_run=dry_run
    )
    return agent.run()
