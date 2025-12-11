#!/usr/bin/env python3
"""
Test Failure Analysis Agent CLI

Analyzes test failures from a CI run using AI and proposes fixes.

Usage:
    python scripts/analyze-failures.py --run-id <uuid>
    python scripts/analyze-failures.py --latest
    python scripts/analyze-failures.py --run-id <uuid> --dry-run
    python scripts/analyze-failures.py --latest --max-failures 5

Environment variables required:
    SUPABASE_URL - Supabase project URL
    SUPABASE_SERVICE_KEY - Supabase service key
    ANTHROPIC_API_KEY - Anthropic API key (not needed for --dry-run)
"""

import argparse
import os
import sys
from pathlib import Path

# Add python-sidecar to path for imports
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SIDECAR_DIR = PROJECT_ROOT / "python-sidecar"
sys.path.insert(0, str(SIDECAR_DIR))

from app.analysis.agent import run_analysis


def get_latest_run_id():
    """Fetch the most recent run_id from Supabase."""
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

    client = create_client(url, key)
    result = client.table("test_results").select(
        "run_id"
    ).order(
        "created_at", desc=True
    ).limit(1).execute()

    if not result.data:
        raise ValueError("No test runs found in database")

    return result.data[0]["run_id"]


def main():
    parser = argparse.ArgumentParser(
        description="Analyze test failures and propose fixes"
    )
    parser.add_argument(
        "--run-id",
        required=False,
        help="UUID of the test run to analyze"
    )
    parser.add_argument(
        "--latest",
        action="store_true",
        help="Analyze the most recent test run"
    )
    parser.add_argument(
        "--max-failures",
        type=int,
        default=10,
        help="Maximum number of failures to analyze (default: 10)"
    )
    parser.add_argument(
        "--max-hypotheses",
        type=int,
        default=3,
        help="Maximum hypotheses per failure (default: 3)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip LLM calls and database writes (test plumbing only)"
    )
    parser.add_argument(
        "--repo-root",
        type=str,
        default=str(PROJECT_ROOT),
        help="Path to git repository root (default: auto-detect)"
    )

    args = parser.parse_args()

    # Require either --run-id or --latest
    if not args.run_id and not args.latest:
        print("ERROR: Must specify either --run-id <uuid> or --latest")
        sys.exit(1)

    # Validate environment
    required_env = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]
    if not args.dry_run:
        required_env.append("ANTHROPIC_API_KEY")

    missing = [var for var in required_env if not os.environ.get(var)]
    if missing:
        print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
        sys.exit(1)

    # Resolve run_id
    if args.latest:
        print("Fetching latest run_id from Supabase...")
        run_id = get_latest_run_id()
        print(f"  Found: {run_id}")
    else:
        run_id = args.run_id

    # Run analysis
    print("=" * 60)
    print("Test Failure Analysis Agent")
    print("=" * 60)

    try:
        results = run_analysis(
            repo_root=Path(args.repo_root),
            run_id=run_id,
            max_failures=args.max_failures,
            max_hypotheses=args.max_hypotheses,
            dry_run=args.dry_run
        )

        # Print summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)

        if not results:
            print("No failures analyzed")
            return

        resolved_count = sum(1 for r in results if r.resolved)
        review_count = sum(1 for r in results if r.human_review_needed)

        print(f"Total analyzed: {len(results)}")
        print(f"Resolved: {resolved_count}")
        print(f"Needs human review: {review_count}")

        print("\nDetails:")
        for result in results:
            status = "RESOLVED" if result.resolved else ("NEEDS REVIEW" if result.human_review_needed else "UNRESOLVED")
            print(f"  [{status}] {result.failure_key}")
            print(f"    Classification: {result.classification}")
            if result.recommendation:
                print(f"    Recommendation: {result.recommendation.description[:80]}...")
            print()

    except Exception as e:
        print(f"ERROR: Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
