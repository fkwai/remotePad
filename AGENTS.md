# RemotePad Helper brief

You are the **Helper** session for RemotePad. You only edit this repo. Do not follow the file-tree or Repos selection in the UI — your cwd is always the RemotePad install root.

## Mission

Change RemotePad (layout, Agent panel, workspaces, viewers, terminal) when the user asks in chat. Prefer small, targeted edits. After work: say what changed and how to verify. Asking the user a question is not “done”.

## Memory

- This file is the durable product map. Chat JSONL is scratch. Helper **Refresh** wipes the chat; lasting work is already in git and this file.
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
| pad window | tree + editor only | `App.tsx` `?pad=` |

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
| Agent host (XiaoBa embed) | `apps/server/src/agent/host.ts`, `ws.ts` — local **catscompany** surface via `createAdapterRuntime` (CatsCo-shaped runtime, no CatsCo cloud/users/WS bot) |
| Workspaces / Repos store | `~/.remotepad/workspaces.json` (server routes under `apps/server`) |
| Favorites | `~/.remotepad/favorites.json` |
| Host / ports | `settings.json` at install root (`host`, `port`, `uiPort`; env overrides) |
| Agent model | `~/.remotepad/llm.json` (DeepSeek key + model + maxTokens; not in git). Host pop **Agent model** form. `GET/PUT /api/llm`. Default max output tokens `32768` → `GAUZ_LLM_MAX_TOKENS`. Applied over XiaoBa `.env` on the next Agent message. |
| Viewer modules | `packages/shared/src/modules.ts` catalog; enabled flags in `~/.remotepad/modules.json`; `GET/PUT /api/modules`; Host pop (computer name) toggles load/unload. Core is always code + folder + diff. Optional: markdown, json, jsonl, csv, image, html, log. Disabled types open as code. New modules should `defaultOn: false`. |
| UI session restore | `tmp/session.json` under this repo |
| Shared protocol | `packages/shared/src/index.ts` |
| Install / LLM path | `apps/server/src/config.ts` (`repoRoot`, `xiaobaPath`) |
| Plot sample | `samples/plotdemo/plotDemo.py` |
| Plot plugin | `plugins/plot-show/` (`rpshow` + PYTHONSTARTUP); plots live under `~/.remotepad/plots/<termId>/` and list in the Terminal plots subpanel |
| Plugin loader | `apps/server/src/plugins.ts` |
| Drag path MIME | `apps/web/src/dnd.ts` — drop on address bar (or the browser URL bar) opens a `?pad=` window with tree + editor that auto-opens the dragged file/dir; `text/plain` and `text/uri-list` both carry the `?pad=` URL so browser address-bar drops navigate to the file, not an empty editor; drop on Agent compose adds a filename chip |

Product docs: `README.md`. This file (`AGENTS.md`) is the helper map — if it disagrees with the tree, update this file.

## Gestures

**Product rule:** single-click and drag are the only gestures users must know. Everything else is on a **right-click menu** that shows the action and its hotkey/gesture hint. Double-click and keyboard shortcuts still work as power shortcuts; they are not the primary way to learn the UI.

**Hotkey hint rule:** when a behavior has a keyboard shortcut or gesture, the matching right-click menu item must show it in its `hint` (e.g. `Ctrl/⌘+S`, `Shift+Enter`, `Del`, `Dbl-click`). Adding a hotkey to a behavior without adding its hint next to the right-click item is a bug; the hint lives on the `MenuItem.hint` field in `ContextMenu.tsx`.

If a job is about click / double-click / reveal / scroll, read this table first. Fix the named widget; do not steal Monaco word-select to implement an **editor tab** job.

| Surface | Gesture | Behavior |
| --- | --- | --- |
| Anywhere (discover) | right-click | Action menu with labels + hints (`ActionMenu` / `ContextMenu.tsx`) |
| Anywhere | text select | no browser / Edge mini-menu (Copy · Search · Copilot); copy and run live on right-click |
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
| Editor **tab** | right-click | reveal / keep / save / revert / close left·right·all; folder tab also **Refresh** |
| Editor **tab** name | unsaved | `●` + accent on the tab (and Files list); no Save/Revert on the top bar — use `Ctrl/⌘+S` or the menu |
| Editor **tab** | new | Inserts on the left; strip scrolls when full, each name compacts to first4…last4 (extension dropped) |
| Editor **tab** | Files toggle | Right side of tab strip; opens a right column. Editor + scrollbar shrink together; closed = both flush to the pane edge |
| Editor **body** | scrollbar | Flush with the editor’s right edge (no overview-ruler gutter); moves with the editor when Files is open |
| Rendered view (md) | width | Fills the full editor width — no `max-width` cap on `.md-body` |
| Rendered view (jsonl) | open / reload | Scrolls to the last record automatically (`JsonlView.tsx` `useLayoutEffect` on `.viewer`); Agent "Open session JSONL" included |
| Editor **tab** | drag | to Terminal / Agent: insert path; to address bar or a new browser tab: open a tree + editor window (`?pad=`) |
| Editor **tab** | close × | Far right, small hit; a 14px gap after the name; hover tints only the ×, not the file name |
| Folder explorer | right-click | **Refresh** reloads this folder listing |
| Editor **tab** | active | Bright left strip + bottom underline (`.tab.active`) |
| Terminal panel | default | Open on load; top bar **Terminal** button or `Ctrl/⌘+\`` toggles show/hide |
| Terminal | plots subpanel | Lists Plotly HTML from this term; closing the term clears its plots |
| Editor **body** | right-click | Run line/selection · Save (hints Shift+Enter / Ctrl+S) |
| Editor **body** | Shift+Enter (`.py`) | Dedent selection and wrap in `exec(compile(...))` so REPL `if`/`else` blocks are not broken by blank lines; other languages paste raw |
| Editor **body** (Monaco) | double-click | word select; not reveal-in-tree |
| Editor **body** (PNG / HTML) | Ctrl+scroll | Zoom that preview only; does not zoom the browser page |
| Host pop (computer name) | click | host / git / terminals · **Agent model** (DeepSeek key + model + max output tokens) · **Viewer modules** on/off |
| Editor **status** bar | `</>` on the left · `Ctrl/⌘+L` | toggle source / rendered for viewer modules; only bar besides the tab strip |
| Editor **body** (image) | left click | pick a pixel; `x` `y` grey (plus RGB if color) on the same bottom status bar |
| File tree rows | indent | chevron `>` and file marks share one column at the same depth (files must not sit extra-indented) |
| Terminal **tab** | right-click | Rename · Close |
| `revealInTree` | — | `App.tsx`; merge into `expanded`; do not `scrollIntoView` unless the user asks to scroll the row to the top |
| Folder explorer item | single click | select only (Ctrl/Cmd multi, Shift range); does **not** open |
| Folder explorer empty | single click | clear selection |
| Folder explorer item | double-click / menu Open | file → open in Editor; dir → navigate Explorer |
| Folder explorer selection | right-click menu / Del | Download (files) · Delete |
| Editor tab / body menu | Revert | discard dirty buffer; `git restore` to HEAD when in a repo, then reload from disk |
| Agent **tab** | right-click | Open session JSONL · Rename · Close |
| Agent history (`☰`) | toggle | docked right column that squeezes the chat (like the Files column); each row shows only a delete icon; JSONL / Rename live in the row's right-click menu (Rename hint `Dbl-click`) |
| Agent compose | — | pinned at bottom (never clipped); input stays enabled while running |
| Agent transcript | — | You / Agent roles; tool rows start folded (▸) and show the first line of the saved print — expand for the full output RemotePad kept (XiaoBa's session file may only have a stub); a jump-to-bottom ↓ button appears once you scroll up more than one viewport from the bottom |
| Helper | Refresh | wipe this Helper chat in place (git + this file keep the work); does not spawn a new helper |
| Agent `+` | click | new general `rp-*` session (cwd follows the selected repo) |

## Agent sessions

- Runtime: local XiaoBa **catscompany** surface (`createAdapterRuntime` + mutable-identity prompts). Not the CatsCo web connector (no login/users/WS bot). LLM from Host **Agent model** / `~/.remotepad/llm.json`.
- Turn end: like CatsCo, always surface XiaoBa `result.text` when `visibleToUser` — including cancel (`已停止…`), fail, and empty-`max_tokens` notices after a partial stream. Track spoken text across tool flushes so a final notice is not dropped when earlier assistant text already streamed. Wire `onThinking` (compaction start/done) into the panel. Do not go idle silently.
- Normal sessions: id `rp-*` (or legacy `remotepad`); cwd follows active repo or tree root.
- Helper sessions: id `helper` (legacy) or `helper-*`; cwd is always `repoRoot`. **Refresh** wipes the current Helper chat. Close / delete like any other session. Clicking a Repos row updates `rp-*` cwd only — it does not reload Helper (or any open) chat.
- Switching Agent tabs abandons an in-flight run (`runGen` + session lock in `host.ts`); the new tab must not stay stuck on Working / “already running”.
- ChangeTracker is per session (`trackers` map + `get tracker()`); never call `.list()` on a missing tracker.
- **Stop** must abandon the same way (`runGen++`, `sending=false`, idle, then `requestInterrupt`) and surface `已停止当前请求。` — interrupt alone waits on the provider abort and leaves Working stuck.
- Two stores, same split as CatsCo: the panel transcript is what was delivered (`~/.remotepad/history/{id}.jsonl`, append-only, user line on Send, assistant text flushed before each tool, full tool print). XiaoBa's model context is only `~/.remotepad/xiaoba/data/sessions/{id}.jsonl` — it rewrites the whole file and stubs tool results after hidden reasoning (`历史工具结果已省略`). Do not copy that file into the panel transcript. `~/.remotepad/xiaoba/logs/` is the process logger, not a third chat.
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
