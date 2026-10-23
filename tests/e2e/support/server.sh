#!/usr/bin/env bash
# Starts the RemotePad API + static server for e2e tests.
# Isolation comes from tests/e2e/support/prepare.ts:
#   HOME                     -> .e2e/home
#   REMOTEPAD_SETTINGS       -> .e2e/settings.json (port 3999)
#   REMOTEPAD_ROOTS          -> .e2e/work (fixtures)
#   REMOTEPAD_SESSION_PATH   -> .e2e/session.json (never tmp/session.json)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE="$ROOT/.e2e"

export HOME="$STATE/home"
export REMOTEPAD_SETTINGS="$STATE/settings.json"
export REMOTEPAD_ROOTS="$STATE/work"
export REMOTEPAD_SESSION_PATH="$STATE/session.json"

exec "$ROOT/apps/server/node_modules/.bin/tsx" "$ROOT/apps/server/src/index.ts"
