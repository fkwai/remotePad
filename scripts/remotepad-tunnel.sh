#!/usr/bin/env bash
# SSH tunnel from your laptop to RemotePad on a remote Linux host.
set -euo pipefail

# shellcheck source=read-settings.sh
source "$(dirname "${BASH_SOURCE[0]}")/read-settings.sh"
REMOTE="${1:-}"
UI_PORT="$REMOTEPAD_UI_PORT"
API_PORT="$REMOTEPAD_PORT"
MODE="${REMOTEPAD_MODE:-dev}"

if [[ -z "$REMOTE" ]]; then
  cat <<EOF
Usage: $(basename "$0") user@remote-host

Forwards localhost:$UI_PORT and localhost:$API_PORT to the remote machine.
Then open http://127.0.0.1:$UI_PORT in your browser (dev mode).

Production (pnpm start on remote, UI served on :$API_PORT only):
  REMOTEPAD_MODE=prod $(basename "$0") user@remote-host
EOF
  exit 1
fi

if [[ "$MODE" == prod ]]; then
  echo "Tunnel → http://127.0.0.1:${API_PORT} (production)"
  exec ssh -N -L "${API_PORT}:127.0.0.1:${API_PORT}" "$REMOTE"
fi

echo "Tunnel → http://127.0.0.1:${UI_PORT} (dev)"
exec ssh -N \
  -L "${UI_PORT}:127.0.0.1:${UI_PORT}" \
  -L "${API_PORT}:127.0.0.1:${API_PORT}" \
  "$REMOTE"
