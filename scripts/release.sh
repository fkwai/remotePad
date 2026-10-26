#!/usr/bin/env bash
# Cut a release on the current branch.
#
#   scripts/release.sh 0.0.2 "Stop button settles with the reply"
#
# Bumps the workspace version, adds a CHANGELOG section, and commits. Merging is
# still a pull request; tagging is a deliberate step after the merge:
#
#   git push origin helper/<feature>   (or scripts/pr.sh <feature>)
#   gh pr merge --squash
#   git tag -a v0.0.2 -m "0.0.2" && git push origin v0.0.2
set -euo pipefail

VERSION="${1:-}"
SUMMARY="${2:-}"
if [ -z "$VERSION" ] || [ -z "$SUMMARY" ]; then
  echo "usage: $0 <version> <summary>" >&2
  exit 1
fi
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "version must look like 1.2.3" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "commit your work first — release.sh only bumps versions and the changelog" >&2
  git status --short | head -10 >&2
  exit 1
fi

python3 - "$VERSION" <<'PY'
import json, re, sys
version = sys.argv[1]
for path in ['package.json', 'apps/web/package.json', 'apps/server/package.json', 'packages/shared/package.json']:
    raw = open(path).read()
    data = json.loads(raw)
    data['version'] = version
    open(path, 'w').write(json.dumps(data, indent=2) + '\n')
    print(f'{path}: {version}')
PY

python3 - "$VERSION" "$SUMMARY" <<'PY'
import re, sys, datetime
version, summary = sys.argv[1], sys.argv[2]
today = datetime.date.today().isoformat()
raw = open('CHANGELOG.md').read()
entry = f"## {version} — {today}\n\n{summary}\n\n"
if raw.startswith('# Changelog'):
    head, _, rest = raw.partition('\n')
    raw = f"{head}\n\n{entry}{rest.lstrip()}"
else:
    raw = f"# Changelog\n\n{entry}{raw}"
open('CHANGELOG.md', 'w').write(raw)
print(f'CHANGELOG.md: {version}')
PY

git add package.json apps/web/package.json apps/server/package.json packages/shared/package.json CHANGELOG.md
# Committing must work on a machine without a configured git identity.
IDENT=()
if [ -z "$(git config user.name || true)" ]; then
  IDENT=(-c user.name="${GIT_AUTHOR_NAME:-kuai}" -c user.email="${GIT_AUTHOR_EMAIL:-noreply@remotePad.local}")
fi
git "${IDENT[@]}" commit -q -m "$VERSION: $SUMMARY"

cat <<EOF
released $VERSION on $(git rev-parse --abbrev-ref HEAD)

next:
  1. run the area's specs, then the full suite
  2. scripts/pr.sh <feature>          # push + pull request
  3. gh pr merge --squash
  4. git switch main && git pull && git tag -a v$VERSION -m "$VERSION" && git push origin v$VERSION
EOF
