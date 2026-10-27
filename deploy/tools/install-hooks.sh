#!/usr/bin/env bash
# Install the repo's hooks (.githooks: pre-commit checks staged files, pre-push runs ./gate.sh --fast) for
# every worktree of this clone. Git resolves a relative core.hooksPath against the main checkout, not the
# worktree, so instead the shared hooks dir gets one-line wrappers that run the hook of the worktree being
# used; a branch without .githooks runs nothing.
set -euo pipefail
hooks="$(git rev-parse --git-common-dir)/hooks"
git config --unset core.hooksPath || true
for name in pre-commit pre-push; do
    cat >"$hooks/$name" <<HOOK
#!/usr/bin/env bash
hook="\$(git rev-parse --show-toplevel)/.githooks/$name"
[ ! -x "\$hook" ] || exec "\$hook" "\$@"
HOOK
    chmod +x "$hooks/$name"
done
echo "hooks: $hooks/{pre-commit,pre-push} run each worktree's .githooks"
