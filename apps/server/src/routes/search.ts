import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FsKind, SearchHit } from '@remotepad/shared';
import { PathError, resolveSafe } from '../paths.ts';

const SKIP = new Set(['node_modules', '.git', 'dist', '.pnpm-store', '.cache']);
const MAX_HITS = 200;
const MAX_DIRS = 1500;

function kindFromDirent(isDir: boolean, isSym: boolean): FsKind {
  if (isDir) return 'dir';
  if (isSym) return 'symlink';
  return 'file';
}

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; path?: string } }>('/api/search', async (req) => {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) throw new PathError('Query is required');
    const root = resolveSafe(req.query.path || '');
    const hits: SearchHit[] = [];
    let dirs = 0;
    let truncated = false;

    async function walk(dir: string) {
      if (truncated) return;
      dirs += 1;
      if (dirs > MAX_DIRS) {
        truncated = true;
        return;
      }
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (SKIP.has(name)) continue;
        const full = path.join(dir, name);
        let stat;
        try {
          stat = await fs.lstat(full);
        } catch {
          continue;
        }
        if (name.toLowerCase().includes(query)) {
          hits.push({
            path: full,
            name,
            kind: kindFromDirent(stat.isDirectory(), stat.isSymbolicLink()),
          });
          if (hits.length >= MAX_HITS) {
            truncated = true;
            return;
          }
        }
        if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(full);
        if (truncated) return;
      }
    }

    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory()) throw new PathError('Search path must be a directory');
    await walk(root);
    return { query: req.query.q, path: root, hits, truncated };
  });
}
