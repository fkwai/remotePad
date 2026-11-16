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

# Port blocks: 600 laptop, 601 server, 603 the agent box. The committed
# settings.json names the laptop block, so on another machine its default ports
# move by whole blocks — the offsets inside a block are the same everywhere.
. "$ROOT/scripts/ports.sh"
_shift=0
_rp_port() {
  local key="$1" laptop="$2" value
  value="$(_rp_setting "$key" "$laptop")"
  # Only a value that is still the laptop default is a default, not a decision.
  if [ "$value" = "$laptop" ]; then echo $(( value + _shift )); else echo "$value"; fi
}
_shift=$(( (RP_BLOCK - 600) * 10 ))

export REMOTEPAD_HOST="${REMOTEPAD_HOST:-$(_rp_setting host 127.0.0.1)}"
export REMOTEPAD_PORT="${REMOTEPAD_PORT:-$(_rp_port port 6000)}"
export REMOTEPAD_UI_PORT="${REMOTEPAD_UI_PORT:-$(_rp_port uiPort 6001)}"
