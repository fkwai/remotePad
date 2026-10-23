# RemotePad product map

RemotePad is the browser UI (files, editor, terminal, agent chat). It does not own the agent runtime. XiaoBa-CLI is a separate tree (`REMOTEPAD_XIAOBA_PATH`, default sibling `../XiaoBa-CLI`). CatsCo maintains that runtime. This repo only embeds it.

There is no Helper agent in the current product. Do not add a worktree, a second port, or a merge-back-into-this-install flow. Agent sessions (`rp-*`) edit the selected repo, not RemotePad. Code under `helper-worktree.ts` is leftover; the Agent panel no longer shows Commit & push / Preview / Merge → main — do not bring those buttons back.

## Mission

Change RemotePad (layout, Agent panel, workspaces, viewers, terminal) when the user asks in chat. Prefer small, targeted edits. After work: say what changed and how to verify.

## Memory

- This file is the durable product map. After any UI, layout, or **gesture** change, add or fix a line here before you say done.
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
| Agent | right dock chat | `AgentPanel.tsx` |
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
| Markdown render + in-place edit | `apps/web/src/components/viewers/MarkdownView.tsx` (`splitChunks` keeps per-block source; `md-block` / `md-edit-area` in `styles.css`) |
| Folder explorer | `apps/web/src/components/FolderView.tsx` |
| Drag/drop MIME | `apps/web/src/dnd.ts` |
| Open-file popup API | `apps/server/src/routes/ui.ts`, `ui-bus.ts` (`POST /api/ui/open`) |
| Agent tabs / chat | `apps/web/src/components/AgentPanel.tsx`, `RightDock.tsx` |
| Agent host (XiaoBa embed) | `apps/server/src/agent/host.ts`, `ws.ts` — loads XiaoBa-CLI `createAdapterRuntime` (`surface: catscompany`). Not a CatsCo login, and not a runtime this repo maintains. |
| CatsCo connector status | Host pop **CatsCo** (`CatsCoStatus.tsx`). `GET /api/catsco` → XiaoBa Dashboard `GET /api/cats/status` (`REMOTEPAD_CATSCO_DASHBOARD`, default `http://127.0.0.1:3800`). Read-only: does **not** start/stop connector. |
| Agent backend | Panel **Local** \| **CatsCo** toggle. Preference `~/.remotepad/agent-backend.json`. Local = embed XiaoBa (`~/.remotepad/xiaoba`). CatsCo = Dashboard `/api/cats/messages/send` + poll on the selected topic (`catsco-chat.ts`); same cloud employee and conversations as app.catsco.cc. Does not start a second connector. |
| CatsCo left panel | In CatsCo mode `☰` opens a docked workspace list: **Bots** (current binding), **Projects** (＋ creates one), each project's agent tasks (＋ creates a task in it, `POST /api/cats/tasks`), and **Chats** (p2p / groups). Click a row to switch topic; selection persists at `~/.remotepad/catsco-selection.json`. Data comes from the local XiaoBa Dashboard: `GET /api/cats/bots|projects|conversations`, `POST /api/cats/projects|tasks`, `POST /api/cats/switch-bot` — rebuild and restart that Dashboard for the project/task routes to appear. |
| Workspaces / Repos store | `~/.remotepad/workspaces.json` (server routes under `apps/server`) |
| Favorites | `~/.remotepad/favorites.json` |
| Host / ports | `settings.json` at install root (`host`, `port`, `uiPort`; env overrides) |
| Agent model | `~/.remotepad/llm.json` (DeepSeek key + model + maxTokens; not in git). Host pop **Agent model** form. `GET/PUT /api/llm`. Default model `deepseek-flash` over OpenAI Chat Completions (`GAUZ_LLM_PROVIDER=openai`, `GAUZ_LLM_OPENAI_API_MODE=chat_completions`). Default max output tokens `32768` → `GAUZ_LLM_MAX_TOKENS`. Applied over XiaoBa `.env` on the next Agent message. |
| Viewer modules | `packages/shared/src/modules.ts` catalog; enabled flags in `~/.remotepad/modules.json`; `GET/PUT /api/modules`; Host pop (computer name) toggles load/unload. Core is always code + folder + diff. Optional: markdown, json, jsonl, csv, image, html, log. Disabled types open as code. New modules should `defaultOn: false`. |
| UI session restore | `tmp/session.json` under this repo |
| Shared protocol | `packages/shared/src/index.ts` |
| Install / LLM path | `apps/server/src/config.ts` (`repoRoot`, `xiaobaPath`) |
| Plot sample | `samples/plotdemo/plotDemo.py` |
| Plot plugin | `plugins/plot-show/` (`rpshow` + PYTHONSTARTUP); plots live under `~/.remotepad/plots/<termId>/` and list in the Terminal plots subpanel |
| Plugin loader | `apps/server/src/plugins.ts` |
| Drag path MIME | `apps/web/src/dnd.ts` — drop on address bar (or the browser URL bar) opens a `?pad=` window with tree + editor that auto-opens the dragged file/dir; `text/plain` and `text/uri-list` both carry the `?pad=` URL so browser address-bar drops navigate to the file, not an empty editor; drop on Agent compose adds a filename chip |

Product docs: `README.md`. This file is the map — if it disagrees with the tree, update this file.

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
| Rendered view (md) | click a block | Typora-style in-place edit: the block becomes a raw-markdown field in the same place (`MarkdownView.tsx` `splitChunks`); typing writes through `onChange` so `●` and `Ctrl/⌘+S` work; blur or `Ctrl/⌘+Enter` renders it again, `Esc` discards |
| Rendered view (md) | drag-select | Selecting text never opens the block editor (copy still works); clicking a link follows it |
| Rendered view (md) | untouched blocks | Keep their exact source bytes — editing one block never reformats the rest of the file; `Ctrl/⌘+L` still gives raw source |
| Rendered view (md) | block split | Breaks at blank lines; a fence or display-math block stays whole only when its closer exists (bounded lookahead), so a stray marker can never merge the rest of the file into one block |
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
| Host pop (computer name) | click | host / git / terminals · **CatsCo** (existing desktop connector status) · **Agent model** (DeepSeek key + model + max output tokens) · **Viewer modules** on/off |
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
| Agent changes list | click a row | opens the **real file** tab (same name/path) in inline red/green review (`before`/`after`); Keep / Undo on the toolbar — no separate `(modify)` tab |
| Agent backend | Local / CatsCo | Local = in-process XiaoBa; CatsCo = cloud list + selected topic (history from Dashboard, not a locked live session). Switching backends always abandons an in-flight run and reloads the transcript — Local stays clickable while CatsCo is Working. |
| Agent `+` | click | new `rp-*` session (cwd follows the selected repo); hidden in CatsCo mode |
| CatsCo workspace `☰` | click | toggles the left list (shows Loading… until Dashboard bots/projects/conversations arrive; ⟳ reloads); row click opens that conversation; project ＋ creates a task; bot row click rebinds the device (confirm prompt) |

## Agent sessions

- Runtime lives in XiaoBa-CLI. This host only calls `createAdapterRuntime({ surface: 'catscompany' })`. LLM is Host **Agent model** / `~/.remotepad/llm.json`, else that XiaoBa tree's `.env`.
- Local skill reload: attach `RuntimeFactory.loadSkills` (warn) to the session. Default `SkillManager.loadSkills()` is fail-fast; missing bundled XiaoBa skills (`skills/xiaoba-knowledge`, `skills/catsco-prompt-editor`) throw ENOENT and XiaoBa maps that to `模型服务暂时不稳定`. Initial load uses the session's skill manager, not the unused adapter copy.
- Sessions: id `rp-*` (or legacy `remotepad`). Cwd is the selected repo or the file-tree root. Not this install.
- Turn end: surface XiaoBa `result.text` when `visibleToUser`, including cancel and fail notices. Do not go idle silently.
- Switching tabs or **Stop** abandons the in-flight run (`runGen` in `host.ts`) so the panel does not stay on Working.
- Delivered chat: `~/.remotepad/history/{id}.jsonl`. XiaoBa model context: `~/.remotepad/xiaoba/data/sessions/{id}.jsonl` (XiaoBa rewrites it; tool text may be stubbed). Logger: `~/.remotepad/xiaoba/logs/` (not the chat). Active id / titles: `~/.remotepad/agent-active.json`.
- ChangeTracker is per session. Snapshot file tools in `onToolStart` (catscompany skips `confirmToolExecution`, so confirm-hook snapshots never run). Do not call `.list()` on a missing tracker.
- Helper worktree APIs remain in the host for now; the Agent UI does not expose Publish / Preview / Merge. Leave `helper-worktree.ts` alone unless the user asks to remove it.

## Git

Work on a branch in this checkout when the user asks to persist. Never push `main`. Never force-push.

## Grep / edit hygiene

- Prefer `grep` with `output_mode=files_with_matches` (or files) first; then read specific files.
- Scope globs under `apps/` or `packages/` — never content-grep the whole tree for `workspace` / lockfile noise.
- Skip `node_modules`, `dist`, `pnpm-lock.yaml`, large binaries.

## Verify

- Typecheck / build when the change warrants it (`pnpm` filters for `@remotepad/web` / `@remotepad/server`).
- For UI: describe what to click. For Agent host: note that the server may need a restart.
