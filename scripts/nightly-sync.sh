#!/usr/bin/env bash
# Bring the nightly lane up to `dev`. Runs when the lane is opened, not on a clock.
#
#   scripts/nightly-sync.sh
#
# `dev` is where work lands; `nightly` is a mirror of it carrying a stamp, so a
# nightly build never claims the release version it was cut from. This box has no
# cron and no systemd, so a midnight job would be a detached process that a reboot
# quietly kills — and a lane restarted at 3am can leave a dead preview behind. The
# sync therefore happens at the moment of use: `preview.sh nightly` calls this
# before it starts anything.
#
# Publishing `origin/nightly` is the GitHub Action's job (.github/workflows/
# nightly.yml, 00:00 UTC); this only prepares the local lane.
#
# Everything that can fail happens before the branch moves, and a failed gate puts
# the branch back where it was.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${REMOTEPAD_NIGHTLY_DIR:-/workspace/git/worktrees/remotepad-nightly}"
BASE="${REMOTEPAD_NIGHTLY_BASE:-origin/dev}"

STAMP="$(date +%Y%m%d)"
say() { printf '[nightly-sync] %s\n' "$*"; }

# A worktree has a `.git` file, not a directory, so ask git itself.
git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 || { say "no nightly worktree at $WT"; exit 1; }

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

# The stamp sits on top of the base, so a quiet day still shows a different HEAD.
# Nothing to do when the version files are the only difference.
if git -C "$WT" merge-base --is-ancestor "$TARGET" "$BEFORE" 2>/dev/null; then
  DRIFT="$(git -C "$WT" diff --name-only "$TARGET" "$BEFORE" \
    | grep -vE '^(package\.json|apps/(web|server)/package\.json|packages/shared/package\.json)$' || true)"
  if [ -z "$DRIFT" ]; then
    say "$BASE unchanged since last sync, nothing to do"
    exit 0
  fi
fi

rollback() {
  say "putting the branch back to $(git -C "$WT" rev-parse --short "$BEFORE")"
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

# Gate before the lane starts on it: the sources have to typecheck.
if ! (cd "$WT" \
      && ./apps/server/node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit \
      && ./apps/server/node_modules/.bin/tsc -b apps/web/tsconfig.json --pretty false); then
  say "typecheck failed"
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

say "ready on $(git -C "$WT" rev-parse --short HEAD) ($NIGHTLY_VERSION)"
