#!/usr/bin/env bash
# Start / stop RemotePad on this machine (localhost by default).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${REMOTEPAD_STATE_DIR:-$HOME/.remotepad}"
# shellcheck source=read-settings.sh
source "$(dirname "${BASH_SOURCE[0]}")/read-settings.sh"
PIDFILE="$STATE_DIR/remotepad.pid"
LOGFILE="$STATE_DIR/remotepad.log"
PORT="$REMOTEPAD_PORT"
UI_PORT="$REMOTEPAD_UI_PORT"
HOST="$REMOTEPAD_HOST"
MODE="${REMOTEPAD_MODE:-dev}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  dev       Run in foreground (pnpm dev — UI on :$UI_PORT, API on :$PORT)
  up        Start in background if not already running
  down      Stop background process started by up
  status    Print whether RemotePad responds on localhost
  open      Print the local URL (dev → :$UI_PORT, prod → :$PORT)

Environment:
  REMOTEPAD_ROOT       Install directory (default: $ROOT)
  REMOTEPAD_HOST       Bind address (settings.json, then env)
  REMOTEPAD_PORT       Backend port (settings.json, then env)
  REMOTEPAD_UI_PORT    Vite dev UI port (settings.json, then env)
  REMOTEPAD_MODE       dev | prod (default: dev)
  REMOTEPAD_STATE_DIR  PID/log directory (default: ~/.remotepad)
  REMOTEPAD_SETTINGS   Path to settings.json (default: ~/.remotepad/settings.json)

Examples:
  $(basename "$0") dev
  $(basename "$0") up && $(basename "$0") open
  REMOTEPAD_HOST=0.0.0.0 REMOTEPAD_MODE=prod $(basename "$0") up
EOF
}

cd "${REMOTEPAD_ROOT:-$ROOT}"

health() {
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
}

ui_url() {
  if [[ "$MODE" == prod ]]; then
    echo "http://127.0.0.1:${PORT}"
  else
    echo "http://127.0.0.1:${UI_PORT}"
  fi
}

cmd_dev() {
  if [[ "$MODE" == prod ]]; then
    exec pnpm start
  fi
  exec pnpm dev
}

cmd_up() {
  mkdir -p "$STATE_DIR"
  if health; then
    echo "RemotePad already running — $(ui_url)"
    return 0
  fi
  if [[ -f "$PIDFILE" ]]; then
    old="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      echo "RemotePad pid $old still running"
      return 0
    fi
    rm -f "$PIDFILE"
  fi
  echo "Starting RemotePad ($MODE) — log: $LOGFILE"
  if [[ "$MODE" == prod ]]; then
    nohup pnpm start >>"$LOGFILE" 2>&1 &
  else
    nohup pnpm dev >>"$LOGFILE" 2>&1 &
  fi
  echo $! >"$PIDFILE"
  for _ in $(seq 1 40); do
    if health; then
      echo "RemotePad up — $(ui_url)"
      return 0
    fi
    sleep 0.25
  done
  echo "RemotePad did not become ready; see $LOGFILE" >&2
  return 1
}

cmd_down() {
  if [[ ! -f "$PIDFILE" ]]; then
    echo "No pid file ($PIDFILE)"
    return 0
  fi
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  rm -f "$PIDFILE"
  if [[ -z "$pid" ]]; then
    echo "Pid file empty"
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
    echo "Stopped pid $pid"
  else
    echo "Process $pid not running"
  fi
}

cmd_status() {
  if health; then
    echo "running — $(ui_url)"
    return 0
  fi
  echo "stopped"
  return 1
}

cmd_open() {
  ui_url
}

main="${1:-}"
case "$main" in
  dev) cmd_dev ;;
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  open) cmd_open ;;
  -h|--help|help|'') usage ;;
  *) echo "Unknown command: $main" >&2; usage; exit 1 ;;
esac
