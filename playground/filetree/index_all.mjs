// ONE FILE. Run:  node playground/filetree/index_all.mjs
// Then open:      http://127.0.0.1:3456
//
// Why this is .mjs, not .html:
//   HTML runs in the browser. Browser JS cannot `import fs` or listdir.
//   Node runs this file. Node CAN listdir. So the "server" half must be Node.
//   The HTML below is only a string that Node sends to the browser.
//
// .js vs .mjs:
//   Same language. .mjs = ES modules (`import`/`export`).
//   .js in Node is often the old style (`require`). We use .mjs so `import` works
//   without extra package.json settings.
//
// "HTML calling mjs" is not import. It is HTTP:
//   browser fetch('/api/list')  →  this Node process  →  fs.readdir  →  JSON back

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = 3456;

async function listDir(dir) {
  const abs = path.resolve(dir || '/');
  const names = await fs.readdir(abs, { withFileTypes: true });
  const entries = names.map((d) => ({
    name: d.name,
    path: path.join(abs, d.name),
    kind: d.isDirectory() ? 'dir' : 'file',
  }));
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return { path: abs, entries };
}

const PAGE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>filetree one file</title>
  <style>
    body { font: 14px ui-sans-serif, system-ui; margin: 16px; background: #111; color: #eee; }
    h1 { font-size: 16px; color: #9ad; }
    .hint { color: #888; font-size: 12px; max-width: 52em; }
    ul { list-style: none; padding-left: 16px; margin: 0; border-left: 1px solid #333; }
    button { background: none; border: 0; color: #8ab4d8; cursor: pointer; font: inherit; }
    .file { color: #aaa; }
    .err { color: #e66; }
  </style>
</head>
<body>
  <h1>one file, two worlds</h1>
  <p class="hint">
    Everything above the PAGE string in index_all.mjs is Node (disk).<br>
    Everything in this page is the browser. The only "call" is fetch() below.
  </p>
  <div id="tree"></div>
  <script>
    async function load(dir) {
      const res = await fetch('/api/list?path=' + encodeURIComponent(dir));
      return res.json();
    }
    function row(item) {
      const li = document.createElement('li');
      if (item.kind !== 'dir') {
        li.innerHTML = '<span class="file">' + item.name + '</span>';
        return li;
      }
      const btn = document.createElement('button');
      btn.textContent = '> ' + item.name;
      btn.onclick = async () => {
        if (li.dataset.open === '1') {
          li.dataset.open = '0';
          btn.textContent = '> ' + item.name;
          li.querySelector('ul')?.remove();
          return;
        }
        const data = await load(item.path);
        if (data.error) { li.innerHTML += '<div class="err">' + data.error + '</div>'; return; }
        li.dataset.open = '1';
        btn.textContent = 'v ' + item.name;
        const ul = document.createElement('ul');
        for (const child of data.entries) ul.appendChild(row(child));
        li.appendChild(ul);
      };
      li.appendChild(btn);
      return li;
    }
    load('/').then((data) => {
      const ul = document.createElement('ul');
      ul.style.borderLeft = '0';
      for (const item of data.entries) ul.appendChild(row(item));
      document.getElementById('tree').appendChild(ul);
    });
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1:' + PORT);
  if (u.pathname === '/api/list') {
    try {
      const body = JSON.stringify(await listDir(u.searchParams.get('path') || '/'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('open http://127.0.0.1:' + PORT);
});
