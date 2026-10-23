#!/usr/bin/env bash
# Open (or refresh) the pull request for a feature worktree.
#
#   scripts/pr.sh <feature> [title]
#
# Expects helper/<feature> to exist as a worktree branch (scripts/dev-worktree.sh).
# Pushes the branch and opens a PR against main. `gh` is optional: without it the
# script pushes and prints the compare URL, which opens the same PR form.
set -euo pipefail

NAME="${1:-}"
TITLE="${2:-}"
if [ -z "$NAME" ]; then
  echo "usage: $0 <feature> [title]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="helper/$NAME"
BASE="${REMOTEPAD_PR_BASE:-main}"

# Locate the worktree that owns the branch (paths and branch are whitespace free
# in this repo, so a simple parse is enough).
WT="$(git -C "$ROOT" worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
  /^worktree /{ wt=$2 }
  $0=="branch " b { print wt }
')"
if [ -z "$WT" ]; then
  echo "no worktree for $BRANCH — run scripts/dev-worktree.sh $NAME first" >&2
  exit 1
fi

if [ -n "$(git -C "$WT" status --porcelain)" ]; then
  echo "uncommitted changes in $WT — commit them first" >&2
  git -C "$WT" status --short | head -10 >&2
  exit 1
fi

git -C "$WT" push -u origin "$BRANCH"

SUFFIX="$(git -C "$WT" log -1 --format='%h %s')"
[ -z "$TITLE" ] && TITLE="$SUFFIX"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if gh pr view "$BRANCH" --json url >/dev/null 2>&1; then
    echo "PR already open: $(gh pr view "$BRANCH" --json url --jq .url)"
  else
    gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --fill
  fi
  exit 0
fi

echo "gh not available here. Branch pushed; open the PR at:"
echo "  https://github.com/$(git -C "$WT" remote get-url origin | sed -E 's#.*github.com[:/](.+)\.git#\1#')/compare/$BASE...$BRANCH?expand=1"
