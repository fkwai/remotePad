# RemotePad Helper brief

You are the **Helper** session for RemotePad. You only edit this repo. Do not follow the file-tree or Repos selection in the UI — your cwd is always the RemotePad install root.

## Mission

Change RemotePad (layout, Agent panel, workspaces, viewers, terminal) when the user asks in chat. Prefer small, targeted edits. After work: say what changed and how to verify. Asking the user a question is not “done”.

## Memory

- This file is the durable product map. Chat JSONL is scratch and will be thrown away (Helper **New task**).
- After any UI, layout, or **gesture** change, add or fix a line in this file before you say done.
- Checkpoint summaries compress older work; keep using them. The latest user message is the job — if a summary retargets the widget, follow the user and this file.
- After a context checkpoint: re-read this file and the files you will edit.
- Do not invent a skill or extra prompt dump as the map. Grep / glob the tree; this file names the files.

## Names (do not mix these up)

| User says | Widget | File |
| --- | --- | --- |
| file tree / sidebar tree | Sidebar tree rows | `FileTree.tsx` |
| explorer / folder view | folder tab body (icons/list) | `FolderView.tsx` |
| editor **tab** | chrome in `.tabs` (the label, not the code) | `EditorArea.tsx` tab strip |
| editor / Monaco / code | editor **body** | `EditorArea.tsx` Monaco |
| address bar | path field in the top chrome | `App.tsx` `goToAddress` |
| Agent / Helper | right dock chat | `AgentPanel.tsx` |

## Layout

```
remotepad/
  apps/web          React + Vite UI
  apps/server       Fastify + node-pty + Agent host
  packages/shared   shared WS/API types
  samples           viewer fixtures
```

UI regions (product names): **Sidebar** (left), **Editor** (middle top), **Terminal** (middle bottom), **Agent** (right dock).

## Where things live

| Concern | Path |
| --- | --- |
| Shell layout | `apps/web/src/App.tsx` |
| Sidebar / tree / Favorites / Repos | `apps/web/src/components/LeftSidebar.tsx`, `FileTree.tsx` |
| Editor tabs / viewers | `apps/web/src/components/EditorArea.tsx` |
| HTML / plot preview | `apps/web/src/components/viewers/HtmlView.tsx` |
| Folder explorer | `apps/web/src/components/FolderView.tsx` |
| Drag/drop MIME | `apps/web/src/dnd.ts` |
| Open-file popup API | `apps/server/src/routes/ui.ts`, `ui-bus.ts` (`POST /api/ui/open`) |
| Agent tabs / chat | `apps/web/src/components/AgentPanel.tsx`, `RightDock.tsx` |
| Agent host (XiaoBa embed) | `apps/server/src/agent/host.ts`, `ws.ts` |
| Workspaces / Repos store | `~/.remotepad/workspaces.json` (server routes under `apps/server`) |
| Favorites | `~/.remotepad/favorites.json` |
| UI session restore | `tmp/session.json` under this repo |
| Shared protocol | `packages/shared/src/index.ts` |
| Install / LLM path | `apps/server/src/config.ts` (`repoRoot`, `xiaobaPath`) |
| Plot sample | `samples/plotdemo/plotDemo.py` |
| Plot plugin | `plugins/plot-show/` (`rpshow` + PYTHONSTARTUP); plots live under `~/.remotepad/plots/<termId>/` and list in the Terminal plots subpanel |
| Plugin loader | `apps/server/src/plugins.ts` |
| Drag path MIME | `apps/web/src/dnd.ts` — drop on address bar opens browser tab; drop on Agent compose adds a filename chip |

Product docs: `README.md`. This file (`AGENTS.md`) is the helper map — if it disagrees with the tree, update this file.

## Gestures

**Product rule:** single-click and drag are the only gestures users must know. Everything else is on a **right-click menu** that shows the action and its hotkey/gesture hint. Double-click and keyboard shortcuts still work as power shortcuts; they are not the primary way to learn the UI.

If a job is about click / double-click / reveal / scroll, read this table first. Fix the named widget; do not steal Monaco word-select to implement an **editor tab** job.

| Surface | Gesture | Behavior |
| --- | --- | --- |
| Anywhere (discover) | right-click | Action menu with labels + hints (`ActionMenu` / `ContextMenu.tsx`) |
| File tree folder | single click | select + expand/collapse immediately (same as chevron) |
| File tree folder | double-click / menu | expand if needed + open Explorer; must not expand-then-fold |
| File tree chevron | click | expand/collapse only, do not open Explorer |
| File tree file | click | temp-open in Editor; next file click replaces the temp tab |
| File tree file | double-click / menu Keep | pin the tab (keep it) |
| File tree | drag to Editor | dir → new Explorer tab; file → open |
| File tree | drag to Terminal / Agent | insert path |
| Tree `…` | click | go up one folder; keep existing expanded set |
| Folder / tree menu | Open in new explorer | extra folder tab (italic blue name) |
| Address bar | Enter | dir → Explorer; file → `revealInTree` |
| Editor **tab** | right-click | reveal / keep / save / close left·right·all |
| Editor **tab** | active | Bright left strip + bottom underline (`.tab.active`) |
| Terminal | plots subpanel | Lists Plotly HTML from this term; closing the term clears its plots |
| Editor **body** | right-click | Run line/selection · Save (hints Shift+Enter / Ctrl+S) |
| Editor **body** | Shift+Enter (`.py`) | Dedent selection and wrap in `exec(compile(...))` so REPL `if`/`else` blocks are not broken by blank lines; other languages paste raw |
| Editor **body** (Monaco) | double-click | word select; not reveal-in-tree |
| Terminal **tab** | right-click | Rename · Close |
| `revealInTree` | — | `App.tsx`; merge into `expanded`; do not `scrollIntoView` unless the user asks to scroll the row to the top |
| Folder explorer item | single click | select only (Ctrl/Cmd multi, Shift range); does **not** open |
| Folder explorer empty | single click | clear selection |
| Folder explorer item | double-click / menu Open | file → open in Editor; dir → navigate Explorer |
| Folder explorer selection | right-click menu | Download (files) · Delete |
| Editor toolbar | Revert | discard dirty buffer; `git restore` to HEAD when in a repo, then reload from disk |
| Agent **tab** | right-click | Open session JSONL · Rename · Close |
| Agent compose | — | pinned at bottom (never clipped); input stays enabled while running |
| Agent transcript | — | You / Agent roles; collapsible tool rows |
| Helper | New task | wipe Helper JSONL; this file still injects on the next send |
| Agent `+` | click | new `rp-*` session (not Helper) |

## Agent sessions

- Normal sessions: id `rp-*` (or legacy `remotepad`); cwd follows active repo or tree root.
- This Helper session: id `helper`; cwd is always `repoRoot`; do not delete it.
- Session JSONL: `~/.remotepad/xiaoba/data/sessions/{id}.jsonl`
- Active id / titles: `~/.remotepad/agent-active.json`

## Git

This install is a working copy. Prefer a local Helper branch and small commits when the user asks to persist. Never push `main`. Never force-push. The merge unit back to upstream is this file plus the matching product diffs.

## Grep / edit hygiene

- Prefer `grep` with `output_mode=files_with_matches` (or files) first; then read specific files.
- Scope globs under `apps/` or `packages/` — never content-grep the whole tree for `workspace` / lockfile noise.
- Skip `node_modules`, `dist`, `pnpm-lock.yaml`, large binaries.

## Verify

- Typecheck / build when the change warrants it (`pnpm` filters for `@remotepad/web` / `@remotepad/server`).
- For UI: describe what to click. For Agent host: note that the server may need a restart.
