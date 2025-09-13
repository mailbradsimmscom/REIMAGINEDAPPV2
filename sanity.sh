#!/bin/bash
# sanity.sh - collect project + env info for comparison across machines

echo "=============================="
echo "📂 PROJECT SANITY CHECK REPORT"
echo "=============================="

# --- Git state ---
echo ""
echo "🔹 Git"
echo "Branch: $(git branch --show-current 2>/dev/null)"
echo "Last Commit: $(git log -1 --oneline 2>/dev/null)"
echo "Tracked jobs routes:"
git ls-files | grep jobs.route.js || echo "None tracked"
echo "Uncommitted changes:"
git status --short

# --- Node env ---
echo ""
echo "🔹 Node / npm"
echo "Node: $(node -v 2>/dev/null)"
echo "NPM: $(npm -v 2>/dev/null)"
echo "Yarn: $(yarn -v 2>/dev/null || echo 'not installed')"
echo "pnpm: $(pnpm -v 2>/dev/null || echo 'not installed')"
echo "Lockfiles present:"
ls -1 package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null || echo "No lockfiles"

# Top-level deps (truncated to 30 lines for sanity)
echo "Installed dependencies:"
npm ls --depth=0 2>/dev/null | head -n 30

# --- DB sanity ---
echo ""
echo "🔹 Database"
echo "Supabase/DATABASE envs:"
printenv | grep -E 'SUPABASE|DATABASE_URL|PG' || echo "No DB envs found"
if [ -n "$DATABASE_URL" ]; then
  echo "DB now() check:"
  psql "$DATABASE_URL" -c "select now();" 2>/dev/null || echo "psql check failed"
fi

# --- OS + misc ---
echo ""
echo "🔹 System"
echo "User: $(whoami)"
echo "Host: $(hostname)"
echo "OS: $(uname -a)"
echo "PWD: $(pwd)"

echo ""
echo "✅ Report complete."
