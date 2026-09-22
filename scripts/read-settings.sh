#!/usr/bin/env bash
# Load repo settings.json into REMOTEPAD_HOST / REMOTEPAD_PORT / REMOTEPAD_UI_PORT.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="${REMOTEPAD_SETTINGS:-${REMOTEPAD_ROOT:-$ROOT}/settings.json}"

_rp_setting() {
  python3 - "$SETTINGS_FILE" "$1" "$2" <<'PY'
import json, sys
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
  with open(path) as f:
    data = json.load(f)
  val = data.get(key, default)
  if key in ('port', 'uiPort'):
    print(int(val))
  else:
    print(val)
except Exception:
  print(default)
PY
}

export REMOTEPAD_HOST="${REMOTEPAD_HOST:-$(_rp_setting host 127.0.0.1)}"
export REMOTEPAD_PORT="${REMOTEPAD_PORT:-$(_rp_setting port 3847)}"
export REMOTEPAD_UI_PORT="${REMOTEPAD_UI_PORT:-$(_rp_setting uiPort 5173)}"
