# Playground plan

Learn HTML, browser JavaScript, and a tiny Node server by rebuilding RemotePad one piece at a time. Each step is a folder you can run, break, and change. When a step feels obvious, open the real file it copies.

RemotePad itself lives in `apps/web` (the page) and `apps/server` (the disk, terminals, agent). This folder stays plain: one HTML file, one `.mjs` file, no React, no Vite, no pnpm.

## The one idea everything else hangs on

The browser cannot read the Linux disk. It can only draw pixels and send HTTP requests. Node can read the disk. They meet over HTTP (and later a WebSocket).

```
browser (index.html)  --fetch /api/...-->  Node (server.mjs)  --fs-->  disk
```

You already have this in `playground/filetree/`. Later steps reuse it. Do not skip it.

| You say | In this folder | In the real app |
| --- | --- | --- |
| the page | `index.html` | `apps/web` (Vite, port 5173 in dev) |
| the API | `server.mjs` | `apps/server` (Fastify, port 3847) |
| both on one port | this playground | production `pnpm start` only |

## How to use a step

1. Read the comment at the top of that step's `server.mjs` (or just open the HTML if the step has no server).
2. Run the command. One lesson at a time. They all use port **3456**, so stop the previous `node` with Ctrl+C first.
3. Do the **Tinker** line before moving on. That is the actual lesson.
4. Open the **Same idea in RemotePad** file and find the matching function. You are not expected to understand all of it.

Done means: you can say, in one sentence, which side (browser or Node) did the work.

## Status

| Step | Folder | Status |
| --- | --- | --- |
| 0 | `filetree/` | already written |
| 1–10 | not created yet | this plan only |

We build the next folder only after you say the current one makes sense.

---

## Step 0 — two worlds (already here)

**Folder:** `playground/filetree/`

**Run:**

```bash
node playground/filetree/server.mjs
```

Open http://127.0.0.1:3456. Click a folder. It expands.

There are two copies of the same lesson:

- `server.mjs` + `index.html` — page and server in separate files. This is the shape we keep.
- `index_all.mjs` — same thing in one file, so you can see the HTML is just a string Node sends.

**Tinker:** in `server.mjs`, change a folder's `kind` handling, or in the HTML change `> ` to something else. Reload. Which file did you have to edit, and which process actually read the directory?

**Same idea in RemotePad:**

- browser list call: `apps/web/src/api.ts` (`fetch`)
- disk list: `apps/server/src/routes/fs.ts` `GET /api/fs/list`
- drawing the rows: `apps/web/src/components/FileTree.tsx`

---

## Step 1 — a page is boxes

**Folder:** `playground/01-page/`

No JavaScript. No server. Open `index.html` in the browser (a `file://` URL is fine).

Four regions, same names as the product:

```
┌──────────┬────────────────────────┬──────────┐
│          │        Editor          │          │
│ Sidebar  ├────────────────────────┤  Agent   │
│          │       Terminal         │          │
└──────────┴────────────────────────┴──────────┘
```

CSS only: `display: grid` (or flex). Colors so you can see the regions. A one-line note in each box.

**Tinker:** make the Sidebar narrower by changing one CSS number. Reload.

**Same idea in RemotePad:** `apps/web/src/App.tsx` (the shell) and `apps/web/src/styles.css`. The real app uses `react-resizable-panels` for the draggable splitters. We add a dumb splitter later, in step 8.

---

## Step 2 — a click changes the page

**Folder:** `playground/02-click/`

Still no server. One HTML file with a `<script>`.

A list of fake names (hardcoded in the script, not from disk). Click a row: it becomes the selected row and the Editor box shows that name.

Ideas you will touch:

- `document.getElementById`
- `document.createElement` / `appendChild` (this is what the file tree already does)
- `addEventListener('click', ...)`
- one variable that remembers the selection

**Tinker:** add a fourth fake file to the array. Reload. It should show up with no other edits.

**Same idea in RemotePad:** `selected` and `tabs` in `apps/web/src/App.tsx`. React's `useState` is this variable, plus a re-render. We stay on plain variables until step 10.

---

## Step 3 — the page asks Node for JSON

**Folder:** `playground/03-fetch/`

Now you need Node, because `file://` pages are awkward about `fetch`.

```bash
node playground/03-fetch/server.mjs
```

`server.mjs` answers `GET /api/ping` with `{ "ok": true, "time": "..." }`. The page has a button. Click it. The Editor shows the JSON.

Ideas:

- `fetch`, `res.json()`, `async` / `await`
- `Content-Type: application/json`
- a 404 for any other path

**Tinker:** make `/api/ping` also return `note: "hello"`. Show that field in the page. You will edit both files.

**Same idea in RemotePad:** `api()` in `apps/web/src/api.ts`. Every Sidebar / Editor action goes through that helper. The server side is Fastify instead of `node:http`, same job.

---

## Step 4 — click a file, show its text

**Folder:** `playground/04-read/`

Start from the step 0 tree. Add one route: `GET /api/read?path=...` which does `fs.readFile` and returns `{ path, content }`.

Click a **file** (not a folder): Editor shows the text inside a `<pre>` or `<textarea>`. Click another file: the text replaces.

Refuse directories with `{ "error": "..." }` and show that string in red. Step 0 already does this pattern for list errors.

**Tinker:** open a big file and a missing path. Both should fail with a readable message, not a blank page.

**Same idea in RemotePad:** `GET /api/fs/read` in `apps/server/src/routes/fs.ts`. The Editor body is `apps/web/src/components/EditorArea.tsx` (Monaco for code, other viewers for html, images, csv, markdown).

---

## Step 5 — more than one open file

**Folder:** `playground/05-tabs/`

Clicking a file **adds a tab** instead of replacing the only view. Click a tab to show that file again. A small × closes it.

Keep it dumb:

- an array `tabs` of `{ path, name, content }`
- one string `active` for which tab is showing
- re-render the tab strip from that array every time it changes

**Tinker:** open three files, close the middle one, check the Editor still shows the right text.

**Same idea in RemotePad:** `tabs` and `activePath` in `App.tsx`. The strip itself is the top of `EditorArea.tsx`. Real tabs also have a "temp" tab that the next click replaces; we can add that as a second tinker, not the first goal.

---

## Step 6 — type, then save

**Folder:** `playground/06-save/`

The Editor is a `<textarea>`. A Save button sends:

```
PUT /api/write
{ "path": "...", "content": "..." }
```

Node writes the file with `fs.writeFile`. The button label changes to "saved" for a second.

Do not autosave. One explicit click so you can see the request.

**Tinker:** change a file in the textarea, save, then `cat` that path in a normal terminal. The bytes on disk should match.

**Same idea in RemotePad:** `PUT /api/fs/write` in `routes/fs.ts`. The Editor toolbar Save action lives in `App.tsx` / `EditorArea.tsx`.

---

## Step 7 — the four regions, with the tree in the Sidebar

**Folder:** `playground/07-shell/`

Put the pieces into the step 1 layout:

| Region | What is inside |
| --- | --- |
| Sidebar | the file tree from step 4 |
| Editor | tabs + textarea from steps 5 and 6 |
| Terminal | a dark box that only says "terminal later" |
| Agent | a dark box that only says "agent later" |

Still one port, still no React. This is the first time the page looks like RemotePad.

**Tinker:** hide the Terminal box with a button, the way the top bar **Terminal** button does. The Editor should grow to fill the gap.

**Same idea in RemotePad:** `App.tsx` composes `LeftSidebar`, `EditorArea`, `TerminalPanel`, `RightDock`.

---

## Step 8 — drag the splitter

**Folder:** `playground/08-split/`

A 4px bar between Sidebar and Editor. `mousedown` / `mousemove` / `mouseup` on `window` changes the Sidebar width. Let go and it stays.

**Tinker:** drag until the Sidebar is almost gone. It should stop at a minimum width (pick a number, like 120px) instead of disappearing.

**Same idea in RemotePad:** `Panel` and `PanelResizeHandle` from `react-resizable-panels` in `App.tsx`. The library is this mouse logic, already written.

---

## Step 9 — the server can talk first

**Folder:** `playground/09-socket/`

HTTP is the browser asking. A terminal needs the server to push bytes whenever the program prints. That is a WebSocket: one connection, messages both ways.

Tiny version, no real shell:

- page opens `new WebSocket('ws://127.0.0.1:3456/ws')`
- server sends `{ "type": "tick", "n": 1 }` once a second
- Terminal box appends each tick
- a text field sends `{ "type": "say", "text": "hi" }` and the server sends it back prefixed with `echo:`

**Tinker:** stop the server with Ctrl+C. The page should show "disconnected", not freeze. Start the server again and reload.

**Same idea in RemotePad:**

- terminal socket: `apps/server/src/terminal/ws.ts` (`/ws/term`) and `apps/web/src/components/TerminalPanel.tsx`
- file-change socket: `apps/server/src/watch.ts` (`/ws/events`)
- agent socket: `apps/server/src/agent/ws.ts` (`/ws/agent`)

The real terminal uses `node-pty` (a pseudo-terminal), not `echo`. We do not put `node-pty` in the playground. Once step 9 is clear, reading `terminal/ws.ts` is the next jump, not another toy.

---

## Step 10 — the same page, written with React

**Folder:** `playground/10-react/`

Only after steps 1–7 feel boring.

Copy the step 7 shell into a single React file loaded from a CDN (still no Vite). The point is the translation:

| Plain JS you already wrote | React name |
| --- | --- |
| a `let tabs = []` plus a function that redraws | `useState` |
| click handler that mutates and redraws | event handler that calls the setter |
| `createElement('li', ...)` | JSX `<li>` |

**Tinker:** find one `useState` and say which step's variable it replaced.

**Same idea in RemotePad:** `apps/web/src/main.tsx` mounts `<App />`. `FileTree.tsx` is the step 0 tree, rewritten this way. Vite (port 5173) is only the dev server that compiles that JSX and proxies `/api` to port 3847.

---

## What we will not rebuild here

These exist in the real app. The playground stops at the mechanism, then you read the file.

| Piece | Read this | Why it stays out |
| --- | --- | --- |
| Monaco editor | `EditorArea.tsx` | a whole code editor; a `<textarea>` teaches the same data flow |
| Real shell | `terminal/ws.ts`, `terminal/sessionManager.ts` | `node-pty` hides the lesson under C++ build details |
| Agent / XiaoBa | `agent/host.ts`, `AgentPanel.tsx` | a second product embedded over a WebSocket |
| Favorites, Repos, git | `routes/favorites.ts`, `routes/workspaces.ts`, `routes/git.ts` | more JSON routes, same shape as `/api/list` |
| Right-click menus | `ContextMenu.tsx` | worth a small extra later if you want it; not required to see the shell |

## Suggested order for a sitting

1. Re-run step 0 and do its tinker.
2. Say which of steps 1–3 you want written next (1 if the HTML/CSS boxes are still fuzzy, 3 if fetch is the fuzzy part, 4 if the tree already makes sense and you want file contents).
