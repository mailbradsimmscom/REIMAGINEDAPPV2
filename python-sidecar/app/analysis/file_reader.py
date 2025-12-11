"""
File system and git operations for code investigation.

Provides utilities to:
1. Read source files with line-limited context
2. Get git history for files
3. Get recent commits between runs
4. Extract relevant code snippets around failure locations
"""

import subprocess
from pathlib import Path
from typing import Optional


# Maximum characters to return from file reads
MAX_FILE_CHARS = 10000
# Maximum lines of context around a specific line
CONTEXT_LINES = 20


def read_file(repo_root: Path, file_path: str, max_chars: int = MAX_FILE_CHARS) -> Optional[str]:
    """
    Read a file from the repository.

    Args:
        repo_root: Root of the git repository
        file_path: Relative path to the file
        max_chars: Maximum characters to return

    Returns:
        File contents (truncated if needed), or None if file doesn't exist
    """
    full_path = repo_root / file_path
    if not full_path.exists():
        return None

    try:
        content = full_path.read_text(encoding="utf-8")
        if len(content) > max_chars:
            return content[:max_chars] + f"\n\n... [truncated, {len(content)} total chars]"
        return content
    except Exception:
        return None


def read_file_lines(
    repo_root: Path,
    file_path: str,
    start_line: int,
    end_line: int
) -> Optional[str]:
    """
    Read specific lines from a file.

    Args:
        repo_root: Root of the git repository
        file_path: Relative path to the file
        start_line: First line to read (1-indexed)
        end_line: Last line to read (1-indexed, inclusive)

    Returns:
        Selected lines with line numbers, or None if file doesn't exist
    """
    full_path = repo_root / file_path
    if not full_path.exists():
        return None

    try:
        lines = full_path.read_text(encoding="utf-8").splitlines()
        # Convert to 0-indexed
        start_idx = max(0, start_line - 1)
        end_idx = min(len(lines), end_line)

        result_lines = []
        for i in range(start_idx, end_idx):
            result_lines.append(f"{i + 1:4d} | {lines[i]}")

        return "\n".join(result_lines)
    except Exception:
        return None


def read_file_context(
    repo_root: Path,
    file_path: str,
    center_line: int,
    context: int = CONTEXT_LINES
) -> Optional[str]:
    """
    Read lines around a specific line number.

    Args:
        repo_root: Root of the git repository
        file_path: Relative path to the file
        center_line: Line to center on (1-indexed)
        context: Number of lines before and after

    Returns:
        Lines with context and line numbers, or None if file doesn't exist
    """
    start = max(1, center_line - context)
    end = center_line + context
    return read_file_lines(repo_root, file_path, start, end)


def get_recent_commits(
    repo_root: Path,
    file_path: Optional[str] = None,
    limit: int = 10
) -> list[dict]:
    """
    Get recent commits, optionally filtered by file.

    Args:
        repo_root: Root of the git repository
        file_path: Optional file to filter commits
        limit: Maximum number of commits to return

    Returns:
        List of commit dicts with sha, message, author, date
    """
    cmd = [
        "git", "log",
        f"-{limit}",
        "--format=%H|%s|%an|%ai"
    ]
    if file_path:
        cmd.extend(["--", file_path])

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True
        )

        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|", 3)
            if len(parts) >= 4:
                commits.append({
                    "sha": parts[0][:8],  # Short SHA
                    "message": parts[1],
                    "author": parts[2],
                    "date": parts[3]
                })
        return commits

    except subprocess.CalledProcessError:
        return []


def get_commit_diff(repo_root: Path, commit_sha: str, file_path: Optional[str] = None) -> str:
    """
    Get the diff for a specific commit.

    Args:
        repo_root: Root of the git repository
        commit_sha: Commit SHA (short or full)
        file_path: Optional file to filter diff

    Returns:
        Unified diff output
    """
    cmd = ["git", "show", "--format=", commit_sha]
    if file_path:
        cmd.extend(["--", file_path])

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout[:MAX_FILE_CHARS]  # Limit diff size
    except subprocess.CalledProcessError:
        return ""


def get_commits_between(
    repo_root: Path,
    old_sha: str,
    new_sha: str,
    file_path: Optional[str] = None
) -> list[dict]:
    """
    Get commits between two SHAs.

    Args:
        repo_root: Root of the git repository
        old_sha: Earlier commit SHA
        new_sha: Later commit SHA
        file_path: Optional file to filter commits

    Returns:
        List of commit dicts
    """
    cmd = [
        "git", "log",
        "--format=%H|%s|%an|%ai",
        f"{old_sha}..{new_sha}"
    ]
    if file_path:
        cmd.extend(["--", file_path])

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True
        )

        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|", 3)
            if len(parts) >= 4:
                commits.append({
                    "sha": parts[0][:8],
                    "message": parts[1],
                    "author": parts[2],
                    "date": parts[3]
                })
        return commits

    except subprocess.CalledProcessError:
        return []


def find_test_file(repo_root: Path, test_name: str, category: str) -> Optional[str]:
    """
    Find the test file containing a specific test.

    Args:
        repo_root: Root of the git repository
        test_name: Name of the test
        category: Test category (unit, integration, e2e)

    Returns:
        Relative path to test file, or None if not found
    """
    # Map category to directory
    test_dirs = {
        "unit": "tests/unit",
        "integration": "tests/integration",
        "e2e": "tests/e2e",
        "python": "python-sidecar/tests"
    }

    search_dir = test_dirs.get(category, "tests")
    search_path = repo_root / search_dir

    if not search_path.exists():
        return None

    # Search for test name in files
    try:
        result = subprocess.run(
            ["grep", "-rl", test_name, str(search_path)],
            capture_output=True,
            text=True
        )
        if result.stdout.strip():
            # Return first match, relative to repo root
            first_match = result.stdout.strip().split("\n")[0]
            return str(Path(first_match).relative_to(repo_root))
    except subprocess.CalledProcessError:
        pass

    return None


def list_files_in_dir(repo_root: Path, dir_path: str, pattern: str = "*") -> list[str]:
    """
    List files matching a pattern in a directory.

    Args:
        repo_root: Root of the git repository
        dir_path: Relative directory path
        pattern: Glob pattern (e.g., "*.js", "*.test.js")

    Returns:
        List of relative file paths
    """
    full_path = repo_root / dir_path
    if not full_path.exists():
        return []

    return [
        str(p.relative_to(repo_root))
        for p in full_path.glob(pattern)
        if p.is_file()
    ]
