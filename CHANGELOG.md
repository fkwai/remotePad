# Changelog

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
