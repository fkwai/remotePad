# Changelog

## 0.0.3 — 2026-10-26

Promoted from the 2026-10-26 nightly.

- Lanes: stable / dev / nightly, switchable from the version panel; the panel now
  reads the branch's real upstream, so a worktree branch reports the lane it tracks
- Nightly CI: `scripts/nightly.sh` merges main + dev + clean feature branches,
  stamps `X.Y.Z-nightly.DATE`, runs the full suite and only publishes on green;
  runs at 03:00 via `remotepad-nightly.timer`
- Nightly tooling fixes: starts from `origin/nightly` every run, never mistakes a
  failed merge for a conflicting branch, commits the version stamp only after the
  suite passes

## 0.0.2 — 2026-10-26

- Copy / cut / paste files in the Sidebar tree and the Folder Explorer, by menu or
  `Ctrl/Cmd+C/X/V`; pasting next to the original names it `x copy.ext`
- Multiple windows: right-click the wordmark to open another workspace; each tab
  keeps its own layout and its own Agent conversation (`?w=`)
- Lanes: stable (main), dev and nightly, switchable from the version panel
- Agent: drafts and file reviews stay in their conversation; a review diff can be
  edited; the CatsCo Stop button clears when the turn ends, including rounds that
  end on a step
- Fresh profile works: a missing file answers 404 instead of a stack trace, and the
  repos control file is created on first run
- `scripts/nightly.sh` publishes a tested nightly once a day

## 0.0.1 — 2026-10-26

First tagged release.

- Sidebar / Editor / Terminal / Agent shell with click + right-click gestures and
  hints on every menu action
- Viewers: markdown, JSON, JSONL, CSV, image, HTML, log, diffs
- Agent panel: local XiaoBa and CatsCo cloud, per-session repos, tool steps,
  markdown replies
- Agent references: drag a file or paste an editor/terminal selection for a
  colored inline chip; the agent receives the absolute path, line range and code
- Top bar: `Update N` fast-forwards a runtime to `origin/main` and reloads;
  the RemotePad wordmark opens a version panel (version, branch, commit, origin)
- Playwright suite per area (`tests/e2e`, `tests/server`)
- Delivery is worktree → targeted tests → pull request; runtimes pull with one click
