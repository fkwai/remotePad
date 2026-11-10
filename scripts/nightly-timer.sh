#!/usr/bin/env bash
# The clock behind `nightly`: runs scripts/nightly-sync.sh once a night.
#
#   scripts/nightly-timer.sh [start|stop|status]   # default: start in foreground
#
# This box has no cron daemon and no systemd — PID 1 is sshd — so the schedule has
# to live in a process of its own rather than in a crontab. `start` detaches it
# with setsid, writes a pidfile and appends to the log, so it survives this shell.
#
# REMOTEPAD_NIGHTLY_AT sets the wall-clock time (default 00:00, local).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AT="${REMOTEPAD_NIGHTLY_AT:-00:00}"
LOGDIR="${REMOTEPAD_NIGHTLY_LOG_DIR:-$HOME/.remotepad-preview}"
LOG="$LOGDIR/nightly-sync.log"
PIDFILE="$LOGDIR/nightly-timer.pid"
ACTION="${1:-run}"

mkdir -p "$LOGDIR"

say() { printf '[nightly-timer] %s\n' "$*"; }

case "$ACTION" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      say "already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    setsid nohup "$0" run >>"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    say "started pid $(cat "$PIDFILE"), nightly sync at $AT, log $LOG"
    ;;
  stop)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" && say "stopped"
    else
      say "not running"
      rm -f "$PIDFILE"
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      say "running pid $(cat "$PIDFILE"), next sync $AT"
    else
      say "not running"
    fi
    ;;
  run)
    echo $$ > "$PIDFILE"
    trap 'rm -f "$PIDFILE"' EXIT
    say "loop started (pid $$), firing at $AT daily"
    while true; do
      now="$(date +%s)"
      next="$(date -d "today $AT" +%s)"
      # Missed tonight's slot? Wait for tomorrow's rather than firing twice.
      [ "$next" -le "$now" ] && next="$(date -d "tomorrow $AT" +%s)"
      say "sleeping $(( (next - now) / 60 )) min until $(date -d "@$next" '+%F %H:%M')"
      sleep $(( next - now ))
      say "firing: $ROOT/scripts/nightly-sync.sh"
      "$ROOT/scripts/nightly-sync.sh" || say "sync failed with $?"
    done
    ;;
  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 1
    ;;
esac
