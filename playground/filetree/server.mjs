// Tiny file-tree playground. One Node process, one port — like Flask serving
// both an HTML page and JSON. No Vite, no React, no pnpm.
//
//   node playground/filetree/server.mjs
//   open http://127.0.0.1:3456
//
// Browser JS cannot read the Linux disk. It can only HTTP-request this process.
// This file is the only place `fs.readdir` runs.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3456;
const here = path.dirname(fileURLToPath(import.meta.url));

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function listDir(dir) {
  const abs = path.resolve(dir || '/');
  const names = await fs.readdir(abs, { withFileTypes: true });
  const entries = [];
  for (const d of names) {
    entries.push({
      name: d.name,
      path: path.join(abs, d.name),
      kind: d.isDirectory() ? 'dir' : 'file',
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: abs, entries };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  // JSON API — this is what RemotePad's 3847 does
  if (u.pathname === '/api/list') {
    try {
      json(res, 200, await listDir(u.searchParams.get('path') || '/'));
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }

  // HTML page — this is what RemotePad's 5173 does in dev
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const html = await fs.readFile(path.join(here, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`open http://127.0.0.1:${PORT}`);
});
