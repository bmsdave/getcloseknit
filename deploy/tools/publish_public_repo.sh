#!/usr/bin/env bash
# Copy a commit's tree (default origin/main) to the public repository as one new commit there, without this
# repository's history. The public copy is where /agents points Claude Code's plugin marketplace (RELEASE-CHECKLIST.md).
set -euo pipefail
repo=${PUBLIC_REPO:-bmsdave/getcloseknit}
ref=${1:-origin/main}
git fetch -q origin
sha=$(git rev-parse --short "$ref")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if ! git clone -q "https://github.com/$repo.git" "$tmp/public" 2>/dev/null || [ -z "$(git -C "$tmp/public" branch --list)" ]; then
    rm -rf "$tmp/public"; git init -q -b main "$tmp/public"
    git -C "$tmp/public" remote add origin "https://github.com/$repo.git"
fi
find "$tmp/public" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive "$ref" | tar -x -C "$tmp/public"
git -C "$tmp/public" add -A
if git -C "$tmp/public" diff --cached --quiet; then echo "public repo: already at $sha"; exit 0; fi
git -C "$tmp/public" commit -q -m "Close Knit source at $sha"
git -C "$tmp/public" push -q origin HEAD:main
echo "public repo: $repo now at $sha"
