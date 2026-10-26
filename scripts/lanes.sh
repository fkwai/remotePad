#!/usr/bin/env bash
# One running instance per lane, each on its own port.
#
#   scripts/lanes.sh start [stable|dev|nightly]   # start one, or dev + nightly
#   scripts/lanes.sh sync  [name]                 # pull + restart a lane
#   scripts/lanes.sh status
#   scripts/lanes.sh stop  <name>
#
# Why worktrees: a port belongs to a process, and a process runs from a working
# tree. One checkout can only have one branch checked out, so "dev on :6210 while
# stable runs on :3847" needs a second working tree — never a branch switch in the
# tree you are using.
#
# The stable lane is the install you already run (it owns 3847); this script only
# manages the lanes beside it. `preview.sh` does the work, so lanes and feature
# previews share one mechanism, one HOME layout and one tunnel story.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-status}"
NAME="${2:-}"

lane_branch() {
  case "$1" in
    stable) echo main ;;
    dev) echo dev ;;
    nightly) echo nightly ;;
    *) return 1 ;;
  esac
}

start_lane() {
  local name="$1" branch
  branch="$(lane_branch "$name")" || { echo "unknown lane: $name" >&2; return 1; }
  if [ "$name" = stable ]; then
    echo "stable is the install you are already running (port 3847) — nothing to start."
    return 0
  fi
  # preview.sh <name> origin/<branch> creates helper/<name> tracking the lane.
  "$ROOT/scripts/preview.sh" "$name" "origin/$branch"
}

case "$ACTION" in
  start)
    if [ -n "$NAME" ]; then
      start_lane "$NAME"
    else
      start_lane dev
      start_lane nightly
    fi
    ;;
  sync)
    if [ -n "$NAME" ]; then
      "$ROOT/scripts/preview.sh" sync "$NAME"
    else
      "$ROOT/scripts/preview.sh" sync dev
      "$ROOT/scripts/preview.sh" sync nightly
    fi
    ;;
  stop)
    [ -n "$NAME" ] || { echo "usage: $0 stop <name>" >&2; exit 1; }
    "$ROOT/scripts/preview.sh" stop "$NAME"
    ;;
  status)
    "$ROOT/scripts/preview.sh" status
    echo
    echo "stable runs on 3847 (the install). dev and nightly run from their own worktrees."
    echo "Each port needs its own tunnel: ssh -N -L <port>:127.0.0.1:<port> <host>"
    ;;
  ""|-h|--help)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 1
    ;;
esac
