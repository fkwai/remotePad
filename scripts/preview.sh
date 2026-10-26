#!/usr/bin/env bash
# Run a throwaway RemotePad from a feature worktree, next to the live one.
#
#   scripts/preview.sh <feature> [base-ref]   # create/reuse worktree, start it
#   scripts/preview.sh stop <feature>
#   scripts/preview.sh status
#   scripts/preview.sh check <feature>     # smoke the endpoints the UI calls
#   scripts/preview.sh sync <feature>      # pull the branch, rebuild, restart
#
# The preview never touches the instance the user is working in:
#   - its own worktree (helper/<feature>), own node_modules
#   - its own HOME (~/.remotepad-preview/<feature>): favorites, repos, sessions
#   - its own settings file, ports (61xx) and session restore state
#   - its own process group, so stopping it cannot reload or kill the live server
#
# Nothing is restarted and no live file is written: the user keeps working while
# the preview runs, then confirms before anything is merged.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-}"

# State lives next to the main checkout, not the worktree the script runs from:
# start/stop/check must agree, and a preview runs inside its own worktree.
MAIN="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs -r dirname || true)"
[ -n "${MAIN:-}" ] || MAIN="$ROOT"
PREVIEWS="$MAIN/.previews"

port_for() {
  local name="$1" offset="$2"
  printf '%s' "$(( 6100 + ($(printf '%s' "$name" | cksum | cut -d' ' -f1) % 90) * 2 + offset ))"
}

dir_for() { printf '%s' "$PREVIEWS/$1"; }

pid_of_port() {
  local port="$1"
  ss -ltnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

group_of() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
}

stop_one() {
  local name="$1" dir file stopped=0
  dir="$(dir_for "$name")"
  if [ ! -d "$dir" ]; then
    echo "no preview named $name" >&2
    return 1
  fi
  # Kill the whole process group of each recorded server; the group is what
  # `setsid` created, so vite's child workers go with it.
  for file in "$dir"/*.pgid; do
    [ -f "$file" ] || continue
    group="$(cat "$file")"
    [ -n "$group" ] || continue
    kill -- "-$group" 2>/dev/null && stopped=1 || true
  done
  sleep 2
  for file in "$dir"/*.pgid; do
    [ -f "$file" ] || continue
    group="$(cat "$file")"
    [ -n "$group" ] && kill -9 -- "-$group" 2>/dev/null || true
  done
  if [ "$stopped" = 0 ]; then
    echo "preview '$name' had no recorded process group; ports may still be bound" >&2
  fi
  rm -rf "$dir"
  echo "preview '$name' stopped"
}

# Endpoints the UI hits on load, plus the files it offers to open. A fresh
# profile has none of those files, which is where a 500 used to hide.
check_one() {
  local name="$1" dir ui api fail=0 code body control
  dir="$(dir_for "$name")"
  if [ ! -d "$dir" ]; then
    echo "no preview named $name — is it running? (scripts/preview.sh status)" >&2
    return 1
  fi
  ui="$(cat "$dir/ui" 2>/dev/null || echo)" 
  api="$(cat "$dir/api" 2>/dev/null || echo)"
  if [ -z "$ui" ] || [ -z "$api" ]; then
    echo "preview '$name' has no ports recorded" >&2
    return 1
  fi
  echo "checking preview '$name' — ui $ui · api $api"

  for path in / /api/machine /api/favorites /api/repos /api/session /api/modules /api/update /api/previews; do
    if [ "$path" = / ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$ui/")
    else
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$api$path")
    fi
    printf '  %-16s %s\n' "$path" "$code"
    case "$code" in 2*|3*) ;; *) fail=1 ;; esac
  done

  # The repos control file: the panel offers it, so a fresh profile must have it.
  control=$(curl -s --max-time 10 "http://127.0.0.1:$api/api/repos" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("controlPath",""))' 2>/dev/null || true)
  if [ -n "$control" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      "http://127.0.0.1:$api/api/fs/read?path=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$control")")
    printf '  %-16s %s (%s)\n' 'fs/read control' "$code" "$control"
    case "$code" in 2*) ;; *) fail=1 ;; esac
  else
    echo "  fs/read control   (no controlPath reported)"
    fail=1
  fi

  if [ "$fail" = 0 ]; then
    echo "preview '$name': OK"
  else
    echo "preview '$name': FAILED — see $dir/*.log" >&2
  fi
  return "$fail"
}

case "$ACTION" in
  sync)
    NAME="${2:?usage: $0 sync <feature>}"
    WT_ROOT="${REMOTEPAD_WORKTREE_DIR:-$(cd "$ROOT/.." && pwd)/worktrees}"
    mkdir -p "$WT_ROOT" 2>/dev/null || WT_ROOT="$ROOT/.worktrees"
    WT="$WT_ROOT/remotepad-$NAME"
    stop_one "$NAME" >/dev/null 2>&1 || true
    if [ -d "$WT" ]; then
      echo "updating $WT"
      git -C "$WT" pull -q --ff-only || { echo "pull failed — resolve it in $WT" >&2; exit 1; }
      git -C "$WT" log --oneline -1
    else
      echo "no worktree for $NAME — starting a fresh one" >&2
    fi
    exec "$0" "$NAME"
    ;;
  check)
    check_one "${2:?usage: $0 check <feature>}"
    exit $?
    ;;
  stop)
    stop_one "${2:?usage: $0 stop <feature>}"
    exit 0
    ;;
  status)
    found=0
    for dir in "$PREVIEWS"/*/; do
      [ -d "$dir" ] || continue
      name="$(basename "$dir")"
      ui="$(cat "$dir/ui" 2>/dev/null || echo '?')"
      api="$(cat "$dir/api" 2>/dev/null || echo '?')"
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$ui/" || echo 000)
      printf '%-16s ui :%-5s api :%-5s http %s\n' "$name" "$ui" "$api" "$code"
      found=1
    done
    [ "$found" = 1 ] || echo "no previews running"
    exit 0
    ;;
  ""|-h|--help)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac

NAME="$ACTION"
BASE="${2:-origin/main}"

UI="$(port_for "$NAME" 0)"
API="$(port_for "$NAME" 1)"
WT_ROOT="${REMOTEPAD_WORKTREE_DIR:-$(cd "$ROOT/.." && pwd)/worktrees}"
mkdir -p "$WT_ROOT" 2>/dev/null || WT_ROOT="$ROOT/.worktrees"
WT="$WT_ROOT/remotepad-$NAME"
BRANCH="helper/$NAME"

if [ ! -d "$WT" ]; then
  echo "creating worktree $BRANCH from $BASE"
  "$ROOT/scripts/dev-worktree.sh" "$NAME" "$BASE" >/dev/null
fi

PID_DIR="$(dir_for "$NAME")"
mkdir -p "$PID_DIR"

if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$UI/"; then
  echo "preview '$NAME' is already serving: http://127.0.0.1:$UI/"
  exit 0
fi

HOME_DIR="$HOME/.remotepad-preview/$NAME"
mkdir -p "$HOME_DIR/.remotepad"
SETTINGS="$WT/.dev/settings.json"
mkdir -p "$WT/.dev"
printf '{\n  "host": "127.0.0.1",\n  "port": %s,\n  "uiPort": %s\n}\n' "$API" "$UI" > "$SETTINGS"

start_one() {
  local label="$1" dir="$2"; shift 2
  (
    cd "$dir"
    setsid nohup env \
      HOME="$HOME_DIR" \
      REMOTEPAD_SETTINGS="$SETTINGS" \
      REMOTEPAD_SESSION_PATH="$HOME_DIR/session.json" \
      REMOTEPAD_ROOTS="$HOME_DIR" \
      "$@" > "$PID_DIR/$label.log" 2>&1 < /dev/null &
  )
}

start_one api "$WT/apps/server" "$WT/apps/server/node_modules/.bin/tsx" src/index.ts
start_one ui "$WT/apps/web" "$WT/apps/web/node_modules/.bin/vite" --port "$UI" --strictPort

for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$API/api/machine" \
    && curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$UI/"; then
    break
  fi
  sleep 1
done

# Record process groups by port: `setsid` forks, so `$!` is not the server PID.
for pair in "api $API" "ui $UI"; do
  set -- $pair
  pid="$(pid_of_port "$2")"
  group="$(group_of "$pid" || true)"
  if [ -n "${group:-}" ]; then
    echo "$group" > "$PID_DIR/$1.pgid"
  fi
done
echo "$UI" > "$PID_DIR/ui"
echo "$API" > "$PID_DIR/api"

if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$UI/"; then
  echo "preview did not come up; see $PID_DIR/*.log" >&2
  exit 1
fi

cat <<EOF
preview '$NAME' is up — the live instances were not touched

  local   http://127.0.0.1:$UI/
  tunnel  ssh -N -L $UI:127.0.0.1:$UI <host-alias>

  worktree $WT          (branch $BRANCH)
  data     $HOME_DIR     (own favorites, repos, sessions)
  ports    api $API · ui $UI
  logs     $PID_DIR/*.log
  stop     scripts/preview.sh stop $NAME
EOF
