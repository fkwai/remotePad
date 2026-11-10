#!/usr/bin/env bash
# Kept for the old name: the nightly build is now a mirror of `dev`.
#
#   scripts/nightly.sh [--no-restart]   ->  scripts/nightly-sync.sh
#
# The old job merged `main` + `dev` + every clean `origin/helper/*` branch into
# `nightly` and published only on a green full suite. That model needs a
# `nightly` branch with a history of its own, and it never ran on a timer, so the
# channel simply drifted. `dev` is the integration branch now: nightly takes it
# as-is once a night, and the lane is restarted onto it.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nightly-sync.sh" "$@"
