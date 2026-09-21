# RemotePad

A lightweight control surface for remote development.

RemotePad is a browser UI for a Linux machine: browse the filesystem, edit files, render them by type, manage terminal sessions, and optionally chat with a local XiaoBa agent.

## Panels

The window is four named regions. Say **panel** only when you mean the type; use these names for the regions:

| Name | Where | What it holds |
| --- | --- | --- |
| **Sidebar** | left | Favorites, Repos, and the file tree |
| **Editor** | middle top | open files and viewers |
| **Terminal** | middle bottom | terminal sessions |
| **Agent** | right | XiaoBa chat |

```
┌──────────┬────────────────────────┬──────────┐
│          │        Editor          │          │
│ Sidebar  ├────────────────────────┤  Agent   │
│          │       Terminal         │          │
└──────────┴────────────────────────┴──────────┘
```

Do not call the left region the file-tree panel: the tree is only the lower part. The Sidebar stacks two things:

- **Favorites** / **Repos** tabs on top. Favorites are any pinned folders. Repos are Git workspaces (`~/.remotepad/workspaces.json`).
- **Tree** on the bottom: the filesystem starting at the current folder.

**Editor** is the middle-top region, not “view”. A *viewer* is a file mode inside the Editor (Markdown, CSV, image, …).

**Terminal** is the middle-bottom region (`Ctrl/\`` toggles it).

**Agent** is the right dock. Do not call it the AI panel; Agent is the product name in the UI.

## Requirements

- Node.js 20+
- pnpm
- Linux build tools for `node-pty` (`python3`, `make`, `g++`)

On Debian/Ubuntu:

```bash
sudo apt-get install -y python3 make g++
```

pnpm 10 ignores dependency build scripts unless they are allowlisted. This repo allowlists `esbuild` and `node-pty`. If terminals fail with a missing `pty.node`, compile it:

```bash
pnpm --filter @remotepad/server exec npm rebuild node-pty
```

## Run

```bash
pnpm install
pnpm dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

- API/WebSocket server: `127.0.0.1:3847`
- Vite dev UI: `127.0.0.1:5173` (proxies `/api` and `/ws`)

Production:

```bash
pnpm build
pnpm start
```

`pnpm start` serves the built UI from the Fastify process on port 3847.

## Access

The server binds to localhost by default. Reach it with:

- a browser on the same machine
- an SSH tunnel: `ssh -L 5173:127.0.0.1:5173 -L 3847:127.0.0.1:3847 user@host`
- Tailscale: set `REMOTEPAD_HOST` to the Tailscale IP or `0.0.0.0`

There is no authentication. Do not expose this to the public internet.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOTEPAD_HOST` | `127.0.0.1` | Bind address |
| `REMOTEPAD_PORT` | `3847` | Backend port |
| `REMOTEPAD_ROOTS` | _(empty)_ | Extra allowed filesystem roots, colon-separated |
| `REMOTEPAD_TEXT_LIMIT` | `8388608` | Max editable file size in bytes |
| `REMOTEPAD_XIAOBA_PATH` | `../XiaoBa-CLI` (sibling of this repo) | Path to a built XiaoBa-CLI install used by the Agent panel |

The file tree starts at `/`. Allowed paths include `/` plus `$HOME`, the process working directory, the RemotePad install directory, and `REMOTEPAD_ROOTS`.

## How to use

**Click** and **drag** are the basics. For everything else, **right-click** — menus list the action and show the hotkey or gesture on the right (e.g. `Dbl-click`, `Shift+Enter`).

Click **RemotePad** in the top-left for the full help list. Common shortcuts (also shown on menus):

- `Ctrl/Cmd+S` save
- `Ctrl/Cmd+L` address bar · `Enter` opens the path
- `Ctrl+`` toggle terminal
- `Shift+Enter` / `Ctrl/Cmd+Enter` run line or selection in the terminal
- Click a file to temp-open; right-click the file or tab → **Keep tab open**
- Click a folder to expand; right-click → **Open in Explorer**
- Drag paths into Editor / Terminal / Agent
- Favorites & repos: right-click for explorer, startup, terminal, remove; drag to reorder
- Click the computer name for host / git / terminals

Favorites are stored in `~/.remotepad/favorites.json`. Home is pinned by default.

Repos are listed in `~/.remotepad/workspaces.json`. Only Git repositories can be added. Each entry can include `startup`, an array of shell lines sent when you right-click the repo and choose **Run startup**. Click **none** to clear the active repo. Session UI state is stored in `tmp/session.json` in this repo and restored on startup.

```json
{
  "folders": [
    {
      "path": "/workspace/opticsimulation",
      "name": "opticsimulation",
      "startup": [
        "source /workspace/env/optic/bin/activate",
        "/workspace/env/optic/bin/python"
      ]
    }
  ]
}
```

## Viewers

Files open in a rendered view when RemotePad recognizes the type, with a Source toggle:

- Markdown
- JSON (collapsible) and JSONL (one record per row; escaped newlines render as multiline text)
- CSV / TSV tables
- Images
- HTML (sandboxed iframe with scripts allowed — interactive Plotly/Bokeh figures work here)
- Logs / plain text

### Interactive plots

HTML figures (Plotly, etc.) open in the Editor with zoom / pan / hover when you open an `.html` file. Scripts can also ask the UI to open a file via `POST /api/ui/open`.

Quick interactive plot popup (Plotly → RemotePad Editor tab):

Copy `samples/plotdemo/plotDemo.py` into a repo whose workspace `startup` activates a venv with `plotly`, then select all → `Shift+Enter` in RemotePad.

```python
import plotly.express as px
import random

x=[random.random() for _ in range(80)]
y=[random.random() for _ in range(80)]

fig=px.scatter(x=x,y=y,title='random (x, y)')
fig.show()
```

- **Locally:** normal Plotly (`fig.show()` → browser). Needs `pip install plotly pandas`.
- **In RemotePad:** the `plot-show` plugin hooks `show()` in new terminals so the figure opens as an Editor tab (zoom / pan / hover). No `rpshow` import in the demo.

## Git

The Repos list shows a compact HEAD line for each repo (`branch ↑n ↓n *dirty hash message`). Click the computer name for changed files; click a file to open a unified diff.

`samples/gitdemo` is a tiny dirty repo you can add to try this.

## Agent

The right dock defaults to **Agent**. It embeds the XiaoBa runtime from `REMOTEPAD_XIAOBA_PATH` without changing XiaoBa-CLI. Session data for this panel is isolated under `~/.remotepad/xiaoba`.

Each Agent conversation is a XiaoBa session. The live transcript is stored as JSONL at `~/.remotepad/xiaoba/data/sessions/{id}.jsonl`, with extra runtime state in `~/.remotepad/xiaoba/data/session-state/{id}.json`. The active session id and custom titles are in `~/.remotepad/agent-active.json`. Reloading the page restores the active session into both the model context and the chat panel.

The Agent panel is a full-height right dock. Open sessions appear as **tabs** along the top. **+** starts a new session without deleting the others. **☰** opens history to switch, rename, or delete any session. Closing a tab hides it from the strip; the JSONL stays on disk until you Delete. Changed files show as a compact list at the bottom of the panel (`M path +n −n`) with Keep/Undo; click a row for the full diff. Host / git / terminals open from the computer name in the top-right.

**Helper** is a pinned session (`helper`) that always stays in the tab strip. Its working directory is fixed to this install root (`repoRoot`), independent of the Sidebar tree or active Repos selection. It loads `AGENTS.md` into the system prompt so you can ask it to modify RemotePad itself. Chat history is scratch; lasting layout and gesture rules belong in `AGENTS.md`. Helper cannot be closed or deleted. **New task** (same as Clear) wipes the Helper JSONL; the next send still injects the brief. XiaoBa may summarize older turns; the host appends the latest user message verbatim so that remains the job.

Requirements:

- XiaoBa-CLI installed next to RemotePad (or `REMOTEPAD_XIAOBA_PATH`)
- `npm run build` in XiaoBa-CLI, or a `src/` tree that `tsx` can load
- LLM config via `xiaoba config` (`~/.xiaoba/config.json`) or `GAUZ_LLM_*` env vars

Normal agent sessions work in the active repo, or the file-tree root if none is selected. File edits are snapshotted so you can **Accept** or **Undo** them in the panel or in a diff tab. Shell side effects are not undone.

## Repo layout

```
remotepad/
  apps/server    Fastify + node-pty
  apps/web       React + Vite
  packages/shared
  samples        viewer fixtures
```
