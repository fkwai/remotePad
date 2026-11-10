#!/usr/bin/env bash
# Nightly lane: take whatever `dev` has, and run it.
#
#   scripts/nightly-sync.sh [--no-restart]
#
# `dev` is the branch being worked on; `nightly` mirrors it with a version stamp,
# so a nightly build never claims the release version it came from. Without this
# the lane sits on whatever commit it was created from — which is why the nightly
# channel never looked like a nightly.
#
# Everything that can fail happens before the running lane is touched, and a lane
# that comes back broken is rolled back to the commit it served a moment ago: an
# unattended job must not leave a dead preview behind in the morning.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${REMOTEPAD_NIGHTLY_DIR:-/workspace/git/worktrees/remotepad-nightly}"
BASE="${REMOTEPAD_NIGHTLY_BASE:-origin/dev}"
API="${REMOTEPAD_NIGHTLY_API_PORT:-6121}"
UI="${REMOTEPAD_NIGHTLY_UI_PORT:-6120}"
RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0

STAMP="$(date +%Y%m%d)"
say() { printf '[nightly-sync] %s\n' "$*"; }

# A worktree has a `.git` file, not a directory, so ask git itself.
git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 || { say "no nightly worktree at $WT"; exit 1; }

# Unattended: git needs an identity for the stamp commit.
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-nightly}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-nightly@remotePad.local}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-nightly}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-nightly@remotePad.local}"

git -C "$WT" fetch --quiet --prune origin
BEFORE="$(git -C "$WT" rev-parse HEAD)"
TARGET="$(git -C "$WT" rev-parse "$BASE")"
say "nightly $(git -C "$WT" rev-parse --short "$BEFORE") -> $BASE $(git -C "$WT" rev-parse --short "$TARGET")"

if [ "$BEFORE" = "$TARGET" ]; then
  say "already on $BASE, nothing to do"
  exit 0
fi

# The stamp sits on top of the base, so a quiet night still shows a different
# HEAD. Nothing to do when the version files are the only difference: restarting
# a lane that already runs the same code is churn, not a nightly.
if git -C "$WT" merge-base --is-ancestor "$TARGET" "$BEFORE" 2>/dev/null; then
  DRIFT="$(git -C "$WT" diff --name-only "$TARGET" "$BEFORE" \
    | grep -vE '^(package\.json|apps/(web|server)/package\.json|packages/shared/package\.json)$' || true)"
  if [ -z "$DRIFT" ]; then
    say "$BASE unchanged since last night, nothing to do"
    exit 0
  fi
fi

rollback() {
  say "rolling the branch back to $(git -C "$WT" rev-parse --short "$BEFORE")"
  git -C "$WT" reset --hard --quiet "$BEFORE"
}

git -C "$WT" reset --hard --quiet "$BASE"

# A nightly must not claim the release version it was cut from.
BASE_VERSION="$(cd "$WT" && python3 -c 'import json;print(json.load(open("package.json"))["version"].split("-")[0])')"
NIGHTLY_VERSION="${BASE_VERSION}-nightly.${STAMP}"
STAMPED="$(cd "$WT" && python3 - "$NIGHTLY_VERSION" <<'PY'
import json, sys
version = sys.argv[1]
changed = False
for path in ['package.json', 'apps/web/package.json', 'apps/server/package.json', 'packages/shared/package.json']:
    data = json.load(open(path))
    if data.get('version') == version:
        continue
    data['version'] = version
    open(path, 'w').write(json.dumps(data, indent=2) + '\n')
    changed = True
print('changed' if changed else 'same')
PY
)"
if [ "$STAMPED" = changed ]; then
  git -C "$WT" add -A
  git -C "$WT" commit --quiet -m "nightly $STAMP

from $BASE at $(git -C "$WT" rev-parse --short "$TARGET")"
  say "stamped $NIGHTLY_VERSION"
else
  say "version already $NIGHTLY_VERSION"
fi

# Gate before the lane is disturbed: the sources have to typecheck.
if ! (cd "$WT" \
      && ./apps/server/node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit \
      && ./apps/server/node_modules/.bin/tsc -b apps/web/tsconfig.json --pretty false); then
  say "typecheck failed, lane untouched"
  rollback
  exit 1
fi

lock_before="$(git -C "$WT" show "$BEFORE:pnpm-lock.yaml" 2>/dev/null | sha1sum | cut -d' ' -f1)"
lock_after="$(sha1sum < "$WT/pnpm-lock.yaml" | cut -d' ' -f1)"
if [ "$lock_before" != "$lock_after" ]; then
  say "lockfile moved, installing"
  (cd "$WT" && npx -y pnpm@10.15.0 install --frozen-lockfile >/dev/null 2>&1) || {
    say "install failed"
    rollback
    exit 1
  }
fi

HEAD="$(git -C "$WT" rev-parse HEAD)"

restart_lane() {
  "$ROOT/scripts/preview.sh" stop nightly >/dev/null 2>&1 || true
  "$ROOT/scripts/preview.sh" nightly >/dev/null 2>&1 || true
}

if [ "$RESTART" = 1 ]; then
  say "restarting the nightly lane"
  restart_lane
  # The point of the exercise is a lane that answers. If it does not, the commit
  # that was just synced is not one to leave running unattended.
  ok=0
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$API/api/session" \
       && curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$UI/"; then ok=1; break; fi
    sleep 3
  done
  if [ "$ok" != 1 ]; then
    say "lane did not come back on $(git -C "$WT" rev-parse --short "$HEAD")"
    rollback
    restart_lane
    exit 1
  fi
  say "lane is up on $(git -C "$WT" rev-parse --short "$HEAD")"
fi

# Publish only a lane known to run. `nightly` is a mirror, so the push is forced,
# with a lease so a concurrent push is never silently overwritten.
if git -C "$WT" push --quiet --force-with-lease origin "HEAD:refs/heads/nightly"; then
  say "published $NIGHTLY_VERSION at $(git -C "$WT" rev-parse --short HEAD)"
else
  say "WARNING: lane is up but the push failed"
fi
