#!/usr/bin/env bash
# Create an isolated worktree for RemotePad feature work.
#
#   scripts/dev-worktree.sh <feature-name> [base-ref]
#
# The live checkout (/srv/remotepad) is what the user is running: never edit it
# by hand. Work here instead, run the specs for the area you touched, then push
# the branch. Each worktree gets its own settings and ports, so several can run
# and test at once.
set -euo pipefail

NAME="${1:-}"
BASE="${2:-main}"
if [ -z "$NAME" ]; then
  echo "usage: $0 <feature-name> [base-ref]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Sibling of the install by default; fall back inside the repo when the parent
# is not writable (e.g. /srv belongs to root).
WT_ROOT="${REMOTEPAD_WORKTREE_DIR:-$(cd "$ROOT/.." && pwd)/worktrees}"
if ! mkdir -p "$WT_ROOT" 2>/dev/null; then
  WT_ROOT="$ROOT/.worktrees"
fi
WT="$WT_ROOT/remotepad-$NAME"
BRANCH="helper/$NAME"

if [ -e "$WT" ]; then
  echo "worktree already exists: $WT" >&2
  exit 1
fi

# Deterministic, collision-resistant ports from the feature name.
SEED=$(( $(printf '%s' "$NAME" | cksum | cut -d' ' -f1) % 150 ))
API=$(( 4200 + SEED ))
UI=$(( 4500 + SEED ))
E2E_API=$(( 4800 + SEED ))
E2E_UI=$(( 5100 + SEED ))

mkdir -p "$WT_ROOT"
git -C "$ROOT" worktree add -q "$WT" -b "$BRANCH" "$BASE"

mkdir -p "$WT/.dev"
cat > "$WT/.dev/settings.json" <<JSON
{
  "host": "127.0.0.1",
  "port": $API,
  "uiPort": $UI
}
JSON

(cd "$WT" && npx -y pnpm@10.15.0 install --frozen-lockfile >/dev/null 2>&1) || {
  echo "dependency install failed — run it manually in $WT" >&2
}

cat <<EOF
worktree : $WT
branch   : $BRANCH (from $BASE)
ports    : api $API · ui $UI · tests $E2E_API/$E2E_UI

dev:
  cd $WT && REMOTEPAD_SETTINGS=$WT/.dev/settings.json npx -y pnpm@10.15.0 dev

targeted tests (run only what you touched):
  cd $WT && E2E_API_PORT=$E2E_API E2E_UI_PORT=$E2E_UI \\
    npx playwright test tests/e2e/editor-tabs.spec.ts

when green:
  git -C $WT push -u origin $BRANCH
EOF
