# RemotePad

A lightweight control surface for remote development.

RemotePad is a browser UI for a Linux machine: browse the filesystem, edit files, render them by type, and manage terminal sessions. It is not a full IDE and not an agent platform.

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

The file tree starts at `/`. Allowed paths include `/` plus `$HOME`, the process working directory, the RemotePad install directory, and `REMOTEPAD_ROOTS`.

## Keyboard

- `Ctrl/Cmd+S` save the active file
- `Ctrl+`` toggle the terminal panel
- Double-click a terminal tab to rename it
- Right-click the file tree for create / rename / delete / pin favorite / Open terminal here
- Click ★ on a folder to pin it; favorites sit at the top of the file tree

Favorites are stored on the machine in `~/.remotepad/favorites.json`. Home is pinned by default.

## Viewers

Files open in a rendered view when RemotePad recognizes the type, with a Source toggle:

- Markdown
- JSON (collapsible) and JSONL (one record per row; escaped newlines render as multiline text)
- CSV / TSV tables
- Images
- HTML (sandboxed, no scripts)
- Logs / plain text

## Git

If the selected path is inside a Git repo, the right panel shows the branch and changed files. Click a file to open a unified diff. Nothing in RemotePad requires Git.

`samples/gitdemo` is a tiny dirty repo you can select to try this panel.

## Layout

```
remotepad/
  apps/server    Fastify + node-pty
  apps/web       React + Vite
  packages/shared
  samples        viewer fixtures
```
