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

**Terminal** is the middle-bottom region (open by default; top bar **Terminal** or `Ctrl/\`` toggles it).

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

RemotePad listens on localhost on the machine where it runs. There is no authentication — do not expose it to the public internet.

### Remote machine from your laptop

Three steps:

**1 — SSH to the remote and start RemotePad**

```bash
ssh user@remote-host
cd ~/git/remotePad
pnpm install          # first time only
./scripts/remotepad.sh up
```

**2 — On your laptop, open a local tunnel** (leave this terminal running)

```bash
./scripts/remotepad-tunnel.sh user@remote-host
```

One-liner (same ports as repo `settings.json`):

```bash
ssh -N -L 5173:127.0.0.1:5173 -L 3847:127.0.0.1:3847 user@remote-host
```

**3 — Browser**

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Using the same machine? Skip step 2.

**Tailscale / LAN:** set `"host": "0.0.0.0"` in repo `settings.json`, run `pnpm build && REMOTEPAD_MODE=prod ./scripts/remotepad.sh up`, then browse `http://<tailscale-ip>:3847`.

### Always-on service (systemd)

So RemotePad starts when the machine boots and you do not have to SSH in first:

```bash
cd ~/git/remotePad
pnpm install
pnpm build

# edit WorkingDirectory in the unit file, then install:
mkdir -p ~/.config/systemd/user
cp scripts/remotepad.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/remotepad.service   # set WorkingDirectory

systemctl --user daemon-reload
systemctl --user enable --now remotepad.service
loginctl enable-linger $USER   # run at boot even without a login session
```

Check status: `systemctl --user status remotepad.service`

The unit runs production mode (`pnpm start`, port 3847). For dev mode with hot reload, use `./scripts/remotepad.sh up` manually instead.

### Scripts

```bash
chmod +x scripts/remotepad.sh scripts/remotepad-tunnel.sh

# remote — foreground / background
./scripts/remotepad.sh dev
./scripts/remotepad.sh up
./scripts/remotepad.sh status
./scripts/remotepad.sh open
./scripts/remotepad.sh down
```

Shell profile aliases (`~/.bashrc`, `~/.zshrc`):

```bash
export REMOTEPAD_ROOT="$HOME/git/remotePad"
alias remotepad='$REMOTEPAD_ROOT/scripts/remotepad.sh'
alias remotepad-tunnel='$REMOTEPAD_ROOT/scripts/remotepad-tunnel.sh'
```

PowerShell tunnel (Windows laptop):

```powershell
& 'C:\path\to\remotePad\scripts\remotepad-tunnel.ps1' user@remote-host
```

## Environment

Repo `settings.json`: `host`, `port` (API / prod UI), `uiPort` (Vite dev only). Env vars override the file.

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOTEPAD_HOST` | `settings.json` → `127.0.0.1` | Bind address |
| `REMOTEPAD_PORT` | `settings.json` → `3847` | Backend port |
| `REMOTEPAD_UI_PORT` | `settings.json` → `5173` | Vite dev UI port |
| `REMOTEPAD_SETTINGS` | `<install>/settings.json` | Path to settings file |
| `REMOTEPAD_ROOTS` | _(empty)_ | Extra allowed filesystem roots, colon-separated |
| `REMOTEPAD_TEXT_LIMIT` | `8388608` | Max editable file size in bytes |
| `REMOTEPAD_XIAOBA_PATH` | `../XiaoBa-CLI` (sibling of this repo) | Path to a built XiaoBa-CLI install used by the Agent panel |
| `REMOTEPAD_CATSCO_DASHBOARD` | `http://127.0.0.1:3800` | XiaoBa Dashboard URL for **CatsCo** status (existing connector; RemotePad does not start a second one) |

The file tree starts at `/`. Allowed paths include `/` plus `$HOME`, the process working directory, the RemotePad install directory, and `REMOTEPAD_ROOTS`.

## How to use

**Click** and **drag** are the basics. For everything else, **right-click** — menus list the action and show the hotkey or gesture on the right (e.g. `Dbl-click`, `Shift+Enter`).

Click **RemotePad** in the top-left for the full help list. Common shortcuts (also shown on menus):

- `Ctrl/Cmd+S` save
- `Ctrl/Cmd+L` source / rendered · click the address bar, `Enter` opens the path
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

The right dock is a chat client. **XiaoBa is not part of this repo.** RemotePad loads whatever XiaoBa-CLI you point at (`REMOTEPAD_XIAOBA_PATH`, default `../XiaoBa-CLI`) and talks to its `catscompany` runtime in-process. CatsCo keeps that runtime up to date; RemotePad does not fork it, host it, or ship a second copy.

There is no Helper agent, no worktree that edits RemotePad, and no preview port that merges back into this install. An Agent session works in the repo you selected (or the file-tree root). It does not maintain RemotePad.

The panel is a full-height right dock. **+** starts a session (`rp-*`). **☰** opens history. Right-click a tab for **Open session JSONL**, rename, or close. The delivered chat is `~/.remotepad/history/{id}.jsonl`. XiaoBa's own model context (which it rewrites, and may stub old tool output) is `~/.remotepad/xiaoba/data/sessions/{id}.jsonl`. Titles live in `~/.remotepad/agent-active.json`. Click the computer name for host, git, terminals, **CatsCo**, viewer modules, and **Agent model** (key, model, API base, max output tokens in `~/.remotepad/llm.json`).

**CatsCo** in the Host pop is status only: it reads the XiaoBa Dashboard you already run (`REMOTEPAD_CATSCO_DASHBOARD`, default `http://127.0.0.1:3800`) — account, device, connector online/offline. It does not start a second connector.

In the Agent dock, switch **Local** / **CatsCo**. Local uses the embedded XiaoBa runtime. **CatsCo** sends to your cloud employee over the same p2p chat as [app.catsco.cc](https://app.catsco.cc/) (via the Dashboard message API) and polls for replies. Keep the desktop connector online if the cloud agent should use this machine’s tools.

File edits from the agent can be kept or undone in the panel. Shell side effects are not undone.

Requirements:

- A XiaoBa-CLI checkout next to RemotePad (or `REMOTEPAD_XIAOBA_PATH`), built (`npm run build`) or loadable from `src/` via `tsx`
- LLM: Host pop → **Agent model**, or `GAUZ_LLM_*` in that XiaoBa-CLI `.env` when `~/.remotepad/llm.json` has no key
- Optional CatsCo status: XiaoBa Dashboard + connector already running (same as the desktop connector service)

## Repo layout

```
remotepad/
  apps/server    Fastify + node-pty
  apps/web       React + Vite
  packages/shared
  samples        viewer fixtures
```

## TODO

### JS debugger (Node / CDP)

Goal: treat the debugger as a way to **understand code** on any project on the server — not a Cursor clone, and not RemotePad-specific.

**MVP keep**

- **Stop here** — gutter click or editor right-click; hotkey hint (e.g. `F9`)
- **Debug this file** — launch under Node inspector for any absolute path (cwd = that file’s folder / matching repo)
- **Terminal playground** — when paused, type expressions / snippets and eval in the paused frame (soft REPL; no Variables / Watch panels)
- **Call Stack** — list frames; **click a frame (including parents) → open that file/line in the Editor**

**Skip for now**

- Variables / Watch sidebars
- Full VS Code DAP / `vscode-js-debug` embedding
- Browser / Chromium attach
- Sourcemaps for bundled apps
- Attach to arbitrary already-running processes (can follow later)

**Approach:** Chrome DevTools Protocol (CDP) against `node --inspect` — structured `callFrames` for stack jump + `Debugger.evaluateOnCallFrame` for the Terminal playground. Continue / step can stay as Terminal / small controls (`c` / `n` / `s` / `o`) at first.

**Gestures (when built):** right-click editor → Stop here / Debug file; on pause → Editor jumps to line, Call Stack fills, Terminal ready to type.
