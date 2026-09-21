import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FsEntry, FsKind, FsReadResponse } from '@remotepad/shared';
import { PathError, exists, resolveSafe, uniqueRoots } from '../paths.ts';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
};

function kindFromStat(stat: Awaited<ReturnType<typeof fs.lstat>>): FsKind {
  if (stat.isDirectory()) return 'dir';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'file';
}

function looksBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 8000));
  return slice.includes(0);
}

async function toEntry(parent: string, name: string): Promise<FsEntry | null> {
  const full = path.join(parent, name);
  try {
    const stat = await fs.lstat(full);
    return {
      name,
      path: full,
      kind: kindFromStat(stat),
      size: stat.isFile() ? stat.size : undefined,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

export async function registerFsRoutes(app: FastifyInstance) {
  app.get('/api/fs/roots', async () => ({ roots: uniqueRoots() }));

  app.get<{ Querystring: { path?: string } }>('/api/fs/list', async (req) => {
    const target = resolveSafe(req.query.path || '/');
    const stat = await fs.lstat(target);
    if (!stat.isDirectory()) throw new PathError('Not a directory');
    const names = await fs.readdir(target);
    const entries = (await Promise.all(names.map((name) => toEntry(target, name))))
      .filter((item): item is FsEntry => Boolean(item))
      .sort((a, b) => {
        if (a.kind === 'dir' && b.kind !== 'dir') return -1;
        if (a.kind !== 'dir' && b.kind === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
    return { path: target, entries };
  });

  app.get<{ Querystring: { path?: string } }>('/api/fs/read', async (req) => {
    const target = resolveSafe(req.query.path || '');
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new PathError('Cannot read a directory');
    const buf = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const binary = looksBinary(buf) && ext !== '.svg';
    const body: FsReadResponse = {
      path: target,
      encoding: binary ? 'base64' : 'utf8',
      content: binary ? buf.toString('base64') : buf.toString('utf8'),
      size: stat.size,
      binary,
      mime: MIME[ext],
    };
    return body;
  });

  app.get<{ Querystring: { path?: string } }>('/api/fs/raw', async (req, reply) => {
    const target = resolveSafe(req.query.path || '');
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new PathError('Cannot read a directory');
    const ext = path.extname(target).toLowerCase();
    reply.header('Content-Type', MIME[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    return reply.send(await fs.readFile(target));
  });

  app.put<{ Body: { path?: string; content?: string } }>('/api/fs/write', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    if (typeof req.body?.content !== 'string') throw new PathError('Content is required');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, req.body.content, 'utf8');
    return { path: target, ok: true };
  });

  app.post<{ Body: { path?: string } }>('/api/fs/mkdir', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    await fs.mkdir(target, { recursive: true });
    return { path: target, ok: true };
  });

  app.post<{ Body: { path?: string } }>('/api/fs/create', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    if (await exists(target)) throw new PathError('Already exists', 409);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '', { flag: 'wx' });
    return { path: target, ok: true };
  });

  app.post<{ Body: { from?: string; to?: string } }>('/api/fs/rename', async (req) => {
    const from = resolveSafe(req.body?.from || '');
    const to = resolveSafe(req.body?.to || '');
    await fs.rename(from, to);
    return { from, to, ok: true };
  });

  app.delete<{ Querystring: { path?: string } }>('/api/fs/delete', async (req) => {
    const target = resolveSafe(req.query.path || '');
    const stat = await fs.lstat(target);
    await fs.rm(target, { recursive: stat.isDirectory(), force: false });
    return { path: target, ok: true };
  });

  app.get<{ Querystring: { path?: string } }>('/api/fs/stat', async (req) => {
    const target = resolveSafe(req.query.path || '');
    const stat = await fs.lstat(target);
    return {
      path: target,
      kind: kindFromStat(stat),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      image: IMAGE_EXT.has(path.extname(target).toLowerCase()),
    };
  });
}
