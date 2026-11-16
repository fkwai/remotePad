#!/usr/bin/env bash
# The port map. One file decides every RemotePad port, so a lane, a preview and
# the test harness cannot each invent their own range and collide.
#
#   600x  this machine        6000 api · 6001 ui   (the repo default)
#   601x  the shared server   6010/6011 stable · 6012/6013 dev · 6014/6015 nightly
#   602x  reserved
#   604x-607x  previews, derived from the branch name
#
# The leading digit says *where* a process runs, not what it is: the same lane on
# your Mac and on the server get different ports, so a tunnel to the server can
# never shadow the copy in front of you. Before this, the dev lane was 6118, the
# nightly 6120, previews hashed into 6100-6279 and the test harness sat on 3998 —
# four schemes, and 5173/3847 belonged to whichever process started first.
#
# Sourced, not executed: `rp_ports_for <name>` prints "API UI".

RP_LOCAL_API=6000
RP_LOCAL_UI=6001

# Standing lanes on the shared server. Fixed, because a tunnel and a bookmark
# need an address that does not change when a branch name gets longer.
RP_LANE_STABLE_API=6010
RP_LANE_STABLE_UI=6011
RP_LANE_DEV_API=6012
RP_LANE_DEV_UI=6013
RP_LANE_NIGHTLY_API=6014
RP_LANE_NIGHTLY_UI=6015

# Feature previews. 20 pairs is far more than can run at once (each is a full
# vite + tsx pair), and staying below 6080 leaves 602x free for the next machine.
RP_PREVIEW_BASE=6040
RP_PREVIEW_SLOTS=20

# "API UI" for a branch/lane name. Stable, dev and nightly are fixed; anything
# else hashes, so two previews rarely share a port and the same preview keeps
# its port across restarts.
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

# The test harness lives on its own machine-local block so a suite run never
# fights the instance you are looking at.
RP_E2E_API=6009
RP_E2E_UI=6008
RP_E2E_DASHBOARD=6007
