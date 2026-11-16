#!/usr/bin/env bash
# The port map. One file decides every RemotePad port on every machine, so a
# lane, a preview and the test harness cannot each invent their own range.
#
#   block 600  this laptop / default checkout
#   block 601  the shared server (cloud)
#   block 602  reserved
#   block 603  ab739c71617b (the Linux box that runs the agents)
#
# Inside a block the offsets are identical, so "dev is the +2 API" is true
# everywhere and a tunnel is a lookup, not a memory exercise:
#
#   +0 / +1   the install (stable)          e.g. 6030 api · 6031 ui
#   +2 / +3   dev lane                      6032 / 6033
#   +4 / +5   nightly lane                  6034 / 6035
#   +6        auth gate in front of +0     6036
#   +7 / +8 / +9  test harness              6037 dashboard · 6038 ui · 6039 api
#
# Feature previews sit at 604x-607x on every machine: they are throwaway, and a
# name that hashes to the same port on two machines is a feature (the same
# branch always gets the same port).
#
# The leading digit says *where* a process runs. Before this, 3847/5173 were
# shared by whoever started first, the lanes lived at 6118/6120 and previews
# hashed into 6100-6279 — so with a tunnel on 3847, opening 127.0.0.1:3847 on
# your laptop reached the server instead of the copy in front of you.
#
# Sourced, not executed: `rp_ports_for <name>` prints "API UI".
# The block comes from REMOTEPAD_PORT_BLOCK (603 on the agent box), else 600.

# Which block this machine is. An explicit env var wins, then a marker file in
# $HOME, then 600. The marker is what makes `pnpm dev` land in the right block
# without anyone remembering to export anything.
RP_MARKER="${REMOTEPAD_PORT_BLOCK_FILE:-$HOME/.remotepad-port-block}"
if [ -z "${REMOTEPAD_PORT_BLOCK:-}" ] && [ -r "$RP_MARKER" ]; then
  REMOTEPAD_PORT_BLOCK="$(tr -dc '0-9' < "$RP_MARKER" | head -c 3)"
fi
RP_BLOCK="${REMOTEPAD_PORT_BLOCK:-600}"
export REMOTEPAD_PORT_BLOCK="$RP_BLOCK"
RP_BASE=$(( RP_BLOCK * 10 ))

RP_LANE_STABLE_API=$(( RP_BASE + 0 ))
RP_LANE_STABLE_UI=$(( RP_BASE + 1 ))
RP_LANE_DEV_API=$(( RP_BASE + 2 ))
RP_LANE_DEV_UI=$(( RP_BASE + 3 ))
RP_LANE_NIGHTLY_API=$(( RP_BASE + 4 ))
RP_LANE_NIGHTLY_UI=$(( RP_BASE + 5 ))
# HTTP Basic gate in front of the install (remotepad-auth.service), so a phone or
# a coffee-shop laptop can reach it without exposing an unauthenticated IDE.
RP_LANE_AUTH=$(( RP_BASE + 6 ))

RP_E2E_DASHBOARD=$(( RP_BASE + 7 ))
RP_E2E_UI=$(( RP_BASE + 8 ))
RP_E2E_API=$(( RP_BASE + 9 ))

# Feature previews. 20 pairs is far more than can run at once (each is a full
# vite + tsx pair), and staying below 6080 keeps the next block free.
RP_PREVIEW_BASE=6040
RP_PREVIEW_SLOTS=20

# "API UI" for a branch/lane name. Stable, dev and nightly are fixed; anything
# else hashes, so the same preview keeps its port across restarts.
rp_ports_for() {
  local name="$1"
  case "$name" in
    stable|main)
      printf '%s %s' "$RP_LANE_STABLE_API" "$RP_LANE_STABLE_UI" ;;
    dev)
      printf '%s %s' "$RP_LANE_DEV_API" "$RP_LANE_DEV_UI" ;;
    nightly)
      printf '%s %s' "$RP_LANE_NIGHTLY_API" "$RP_LANE_NIGHTLY_UI" ;;
    *)
      local seed=$(( $(printf '%s' "$name" | cksum | cut -d' ' -f1) % RP_PREVIEW_SLOTS ))
      printf '%s %s' "$(( RP_PREVIEW_BASE + seed * 2 ))" "$(( RP_PREVIEW_BASE + seed * 2 + 1 ))" ;;
  esac
}

# The install's own two ports, for settings.json generation and docs.
rp_stable_ports() { rp_ports_for stable; }
