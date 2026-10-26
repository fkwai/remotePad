#!/usr/bin/env bash
# Nightly build: merge every lane into `nightly`, test it, publish it.
#
#   scripts/nightly.sh [--dry-run]
#
# Runs in its own worktree so the instance the user is working in is never
# touched. What it does, in order:
#
#   1. fast-forward `nightly` onto `main`, then merge `dev` and every
#      `origin/helper/*` branch that merges cleanly (conflicts are reported and
#      that branch is skipped — one bad branch must not block the night)
#   2. stamp the version `X.Y.Z-nightly.YYYYMMDD`, so a nightly build never
#      claims to be the release it came from
#   3. install if the lockfile moved, build, run the full test suite
#   4. only if everything passes: commit and push `origin/nightly`
#
# Exit status is non-zero when the night fails, so a timer or CI can report it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir | xargs -r dirname)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

WT_ROOT="${REMOTEPAD_NIGHTLY_DIR:-$MAIN/.nightly}"
WT="$WT_ROOT/work"
# The worktree keeps its own local branch so it never collides with a `nightly`
# branch the user may have checked out; it publishes to origin/nightly.
LOCAL_BRANCH="nightly-ci"
BRANCH="nightly"
STAMP="$(date +%Y%m%d)"
LOG="$WT_ROOT/nightly.log"

mkdir -p "$WT_ROOT"

say() { printf '[nightly] %s\n' "$*"; }

# A dedicated worktree: the live install stays on whatever branch the user chose.
if [ ! -d "$WT" ]; then
  say "creating $WT"
  git -C "$MAIN" fetch --quiet origin
  if git -C "$MAIN" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
    git -C "$MAIN" worktree add --quiet -b "$LOCAL_BRANCH" --track "$WT" "origin/$BRANCH"
  else
    git -C "$MAIN" worktree add --quiet -b "$LOCAL_BRANCH" "$WT" origin/main
  fi
fi

cd "$WT"

# Always start from what is published: this worktree is disposable, and a failed
# or dry run must not leave commits that break the next night's fast-forward.
say "reset to origin/$BRANCH"
git reset --hard --quiet "origin/$BRANCH" 2>/dev/null || say "origin/$BRANCH missing, starting from the current head"

say "fetching"
git fetch --quiet --prune origin

say "nightly -> origin/main"
git merge --ff-only --quiet "origin/main" || {
  say "cannot fast-forward to main: nightly has commits main lacks."
  say "merge main into nightly by hand, or promote nightly to main first."
  exit 1
}

# Every lane that should reach the nightly build. Order matters: dev first, then
# feature branches on top, so a feature branch wins where they touch.
MERGED="main"
SKIPPED=""
for ref in origin/dev $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/helper/*'); do
  git rev-parse --verify --quiet "$ref" >/dev/null || continue
  if git merge-base --is-ancestor "$ref" HEAD; then
    say "$ref already included"
    continue
  fi
  if git merge --no-edit --quiet "$ref" >/dev/null 2>&1; then
    say "merged $ref"
    MERGED="$MERGED $(basename "$ref")"
  else
    say "CONFLICT in $ref — skipped, left for a human"
    git merge --abort 2>/dev/null || true
    SKIPPED="$SKIPPED $ref"
  fi
done

# A nightly must not claim the release version it was cut from.
BASE="$(python3 -c 'import json;print(json.load(open("package.json"))["version"].split("-")[0])')"
NIGHTLY_VERSION="$BASE-nightly.$STAMP"
python3 - "$NIGHTLY_VERSION" <<'PY'
import json, sys
version = sys.argv[1]
for path in ['package.json', 'apps/web/package.json', 'apps/server/package.json', 'packages/shared/package.json']:
    data = json.load(open(path))
    if data.get('version') == version:
        continue
    data['version'] = version
    open(path, 'w').write(json.dumps(data, indent=2) + '\n')
print(f'version {version}')
PY

say "installing"
if ! npx -y pnpm@10.15.0 install --frozen-lockfile >/dev/null 2>&1; then
  say "install failed"
  exit 1
fi

say "building"
if ! npx -y pnpm@10.15.0 build >/dev/null 2>&1; then
  say "build failed"
  exit 1
fi

say "testing (this is the gate)"
if ! node_modules/.bin/playwright test >"$LOG" 2>&1; then
  say "tests failed — see $LOG"
  tail -25 "$LOG" | sed 's/^/[nightly]   /'
  exit 1
fi
say "tests passed: $(grep -Eo '[0-9]+ passed' "$LOG" | tail -1)"

if [ "$DRY" = 1 ]; then
  say "dry run: not committing or pushing $BRANCH"
  exit 0
fi

# The version stamp is committed only now: a failed night leaves nothing behind
# that the next run would have to reconcile.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-nightly}" -c user.email="${GIT_AUTHOR_EMAIL:-nightly@remotePad.local}" \
    commit --quiet -m "nightly $STAMP

merged:$MERGED${SKIPPED:+
skipped:$SKIPPED}"
fi

git push --quiet origin "HEAD:$BRANCH"
say "published $NIGHTLY_VERSION at $(git rev-parse --short HEAD)"
[ -n "$SKIPPED" ] && say "skipped branches:$SKIPPED"
