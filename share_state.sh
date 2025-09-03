#!/usr/bin/env bash
set -euo pipefail

echo "==> Repo status"
git rev-parse --abbrev-ref HEAD
git status --short || true

# Ensure 'origin' remote exists
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "ERROR: No 'origin' remote set."
  echo "Add it with: git remote add origin <YOUR_GITHUB_URL>"
  exit 1
fi

echo "==> Stage and commit all changes"
git add -A
git commit -m "sync: share exact local state for review" || echo "No changes to commit"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Push branch '$BRANCH'"
git push --set-upstream origin "$BRANCH" 2>/dev/null || git push

FULL_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
echo "==> Current commit:"
echo "FULL:  $FULL_SHA"
echo "SHORT: $SHORT_SHA"

TAG="share-$(date +%Y%m%d-%H%M%S)"
echo "==> Create & push tag '$TAG'"
git tag -a "$TAG" -m "share exact state"
git push origin "$TAG" || echo "Tag push failed (already exists?)"

echo "==> Update submodules (safe if none)"
git submodule update --init --recursive

OUT="REIMAGINEDAPP-$SHORT_SHA.zip"
echo "==> Create deterministic archive: $OUT"
git archive -o "$OUT" HEAD

echo "==> Generate MANIFEST.txt"
git ls-files > MANIFEST.txt

echo "==> (Optional) Pull Git LFS objects"
if command -v git-lfs >/dev/null 2>&1; then
  git lfs pull || true
else
  echo "git-lfs not installed (skip if you don't use LFS)"
fi

echo "==> Outputs"
ls -lh "$OUT" MANIFEST.txt

echo "Done. Upload '$OUT' (and MANIFEST.txt if useful)."
