"""
Git worktree sandbox manager.

Provides isolated environment for the agent to:
1. Apply code patches safely
2. Run tests without affecting main checkout
3. Clean up automatically after use

All modifications happen in a temporary worktree, never in the main checkout.
"""

import shutil
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Generator


class WorktreeError(Exception):
    """Raised when worktree operations fail."""
    pass


def _run_git(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """
    Run a git command and return the result.
    Raises WorktreeError on failure.
    """
    result = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        raise WorktreeError(
            f"Git command failed: {' '.join(cmd)}\n"
            f"stderr: {result.stderr}\n"
            f"stdout: {result.stdout}"
        )
    return result


def _verify_git_repo(repo_root: Path) -> None:
    """Verify we're in a valid git repository."""
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        raise WorktreeError(
            f"Not a git repository: {repo_root}\n"
            "The agent must be run from inside a git repo root "
            "(after actions/checkout in CI)."
        )


@contextmanager
def agent_worktree(main_repo_root: Path) -> Generator[Path, None, None]:
    """
    Create an isolated git worktree for the agent to modify safely.

    Usage:
        with agent_worktree(Path("/path/to/repo")) as sandbox:
            # sandbox is a Path to the worktree
            # Make changes, run tests, etc.
            # Worktree is automatically cleaned up on exit

    Args:
        main_repo_root: Path to the main git repository

    Yields:
        Path to the isolated worktree directory

    Raises:
        WorktreeError: If not in a git repo or worktree operations fail
    """
    main_repo_root = Path(main_repo_root).resolve()
    _verify_git_repo(main_repo_root)

    # Create worktrees in a hidden directory
    worktrees_dir = main_repo_root / ".agent-worktrees"
    worktrees_dir.mkdir(exist_ok=True)

    # UUID prevents collision in parallel runs
    worktree_path = worktrees_dir / f"run-{uuid.uuid4().hex}"

    try:
        # Create worktree at current HEAD
        _run_git(
            ["git", "worktree", "add", str(worktree_path), "HEAD"],
            cwd=main_repo_root
        )
        yield worktree_path

    finally:
        # Clean up: remove worktree registration first, then directory
        try:
            _run_git(
                ["git", "worktree", "remove", "--force", str(worktree_path)],
                cwd=main_repo_root
            )
        except WorktreeError:
            # If git worktree remove fails, force-delete the directory
            shutil.rmtree(worktree_path, ignore_errors=True)

        # Also clean up the worktrees directory if empty
        try:
            if worktrees_dir.exists() and not any(worktrees_dir.iterdir()):
                worktrees_dir.rmdir()
        except OSError:
            pass  # Directory not empty or other error, leave it


def apply_patch(sandbox_path: Path, diff_content: str) -> bool:
    """
    Apply a unified diff patch to the sandbox.

    Args:
        sandbox_path: Path to the worktree sandbox
        diff_content: Unified diff format patch

    Returns:
        True if patch applied successfully, False otherwise
    """
    if not diff_content or not diff_content.strip():
        return True  # No patch to apply

    try:
        result = subprocess.run(
            ["git", "apply", "--check", "-"],
            cwd=str(sandbox_path),
            input=diff_content,
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            return False

        # Patch validates, apply it for real
        subprocess.run(
            ["git", "apply", "-"],
            cwd=str(sandbox_path),
            input=diff_content,
            capture_output=True,
            text=True,
            check=True
        )
        return True

    except subprocess.CalledProcessError:
        return False


def revert_changes(sandbox_path: Path) -> None:
    """
    Revert all changes in the sandbox to clean state.

    Args:
        sandbox_path: Path to the worktree sandbox
    """
    subprocess.run(
        ["git", "checkout", "--", "."],
        cwd=str(sandbox_path),
        capture_output=True
    )
    subprocess.run(
        ["git", "clean", "-fd"],
        cwd=str(sandbox_path),
        capture_output=True
    )
