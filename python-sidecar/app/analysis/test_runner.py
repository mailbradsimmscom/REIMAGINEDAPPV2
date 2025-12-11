"""
Test runner for hypothesis validation.

Runs individual tests in the sandbox environment to validate hypotheses.
Supports Node.js (node:test), Playwright, and Python (pytest) tests.
"""

import os
import subprocess
import time
from pathlib import Path
from typing import Optional

from .models import TestRunResult
from .worktree import apply_patch, revert_changes


# Default timeout for test runs (2 minutes)
DEFAULT_TIMEOUT_MS = 120000
# Maximum output to capture
MAX_OUTPUT_CHARS = 5000


def run_test(
    sandbox_path: Path,
    test_file: str,
    test_name: Optional[str] = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS
) -> TestRunResult:
    """
    Run a single test in the sandbox.

    Args:
        sandbox_path: Path to the worktree sandbox
        test_file: Relative path to the test file
        test_name: Optional specific test name to run
        timeout_ms: Timeout in milliseconds

    Returns:
        TestRunResult with status and output
    """
    start_time = time.time()
    timeout_sec = timeout_ms / 1000

    # Determine test framework and build command
    cmd = _build_test_command(test_file, test_name)

    # Set up environment
    env = _build_test_env()

    try:
        result = subprocess.run(
            cmd,
            cwd=str(sandbox_path),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env=env
        )

        duration_ms = int((time.time() - start_time) * 1000)
        stdout = _truncate(result.stdout, MAX_OUTPUT_CHARS)
        stderr = _truncate(result.stderr, MAX_OUTPUT_CHARS)

        if result.returncode == 0:
            return TestRunResult(
                status="PASSED",
                exit_code=result.returncode,
                timed_out=False,
                stdout=stdout,
                stderr=stderr,
                duration_ms=duration_ms
            )
        else:
            return TestRunResult(
                status="FAILED_ASSERTION",
                exit_code=result.returncode,
                timed_out=False,
                stdout=stdout,
                stderr=stderr,
                duration_ms=duration_ms
            )

    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - start_time) * 1000)
        return TestRunResult(
            status="TIMED_OUT",
            exit_code=-1,
            timed_out=True,
            stdout="",
            stderr=f"Test timed out after {timeout_sec}s",
            duration_ms=duration_ms
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return TestRunResult(
            status="INFRA_ERROR",
            exit_code=-1,
            timed_out=False,
            stdout="",
            stderr=str(e),
            duration_ms=duration_ms
        )


def run_test_with_patch(
    sandbox_path: Path,
    test_file: str,
    diff_content: Optional[str],
    test_name: Optional[str] = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS
) -> TestRunResult:
    """
    Apply a patch and run a test, then revert.

    Args:
        sandbox_path: Path to the worktree sandbox
        test_file: Relative path to the test file
        diff_content: Unified diff to apply (or None)
        test_name: Optional specific test name to run
        timeout_ms: Timeout in milliseconds

    Returns:
        TestRunResult with status and output
    """
    try:
        # Apply patch if provided
        if diff_content:
            if not apply_patch(sandbox_path, diff_content):
                return TestRunResult(
                    status="INFRA_ERROR",
                    exit_code=-1,
                    timed_out=False,
                    stdout="",
                    stderr="Failed to apply patch",
                    duration_ms=0
                )

        # Run the test
        result = run_test(sandbox_path, test_file, test_name, timeout_ms)

        return result

    finally:
        # Always revert changes
        revert_changes(sandbox_path)


def _build_test_command(test_file: str, test_name: Optional[str]) -> list[str]:
    """Build the appropriate test command based on file type."""

    # Node.js tests
    if test_file.endswith((".test.js", ".test.ts")):
        cmd = ["node", "--test", test_file]
        if test_name:
            cmd.extend(["--test-name-pattern", test_name])
        return cmd

    # Playwright tests
    if test_file.endswith(".spec.js") or test_file.endswith(".spec.ts"):
        cmd = ["npx", "playwright", "test", test_file]
        if test_name:
            cmd.extend(["--grep", test_name])
        return cmd

    # Python tests
    if test_file.endswith(".py"):
        cmd = ["python", "-m", "pytest", test_file, "-v"]
        if test_name:
            cmd.extend(["-k", test_name])
        return cmd

    # Default: try node --test
    return ["node", "--test", test_file]


def _build_test_env() -> dict:
    """Build environment for test execution."""
    env = os.environ.copy()

    # Set test mode flags
    env["NODE_ENV"] = "test"
    env["SKIP_EXTERNAL"] = "1"  # Don't hit real external services

    # Disable color output for easier parsing
    env["NO_COLOR"] = "1"
    env["FORCE_COLOR"] = "0"

    return env


def _truncate(text: str, max_chars: int) -> str:
    """Truncate text to max characters."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n... [truncated, {len(text)} total chars]"


def detect_test_framework(test_file: str) -> str:
    """Detect the test framework from the file name."""
    if test_file.endswith((".test.js", ".test.ts")):
        return "node"
    if test_file.endswith((".spec.js", ".spec.ts")):
        return "playwright"
    if test_file.endswith(".py"):
        return "pytest"
    return "unknown"
