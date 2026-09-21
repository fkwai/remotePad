import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { UiOpenBody, UiOpenResponse } from '@remotepad/shared';
import { PathError, resolveSafe } from '../paths.ts';
import { publishOpen } from '../ui-bus.ts';

export function plotsRoot(): string {
  return path.join(os.homedir(), '.remotepad', 'plots');
}

export function termPlotDir(termId: string): string {
  const safe = termId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(plotsRoot(), safe);
}

export function clearTermPlots(termId: string): string[] {
  const dir = termPlotDir(termId);
  const removed: string[] = [];
  if (!fs.existsSync(dir)) return removed;
  try {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      try {
        fs.unlinkSync(fp);
        removed.push(fp);
      } catch { /* ignore */ }
    }
    fs.rmdirSync(dir);
  } catch { /* ignore */ }
  return removed;
}

export async function registerUiRoutes(app: FastifyInstance) {
  app.post<{ Body: UiOpenBody }>('/api/ui/open', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    try {
      const st = await fsPromises.stat(target);
      if (!st.isFile()) throw new PathError('Path is not a file', 400);
    } catch (err) {
      if (err instanceof PathError) throw err;
      throw new PathError('File not found', 404);
    }
    const termId = typeof req.body?.termId === 'string' ? req.body.termId.trim() : undefined;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : undefined;
    publishOpen(target, { termId: termId || undefined, title: title || undefined });
    const res: UiOpenResponse = { ok: true, path: target, termId, title };
    return res;
  });

  app.post<{ Body: { termId?: string } }>('/api/ui/plots/clear', async (req) => {
    const termId = req.body?.termId || '';
    if (!termId) throw new PathError('termId is required');
    const removed = clearTermPlots(termId);
    return { ok: true, removed };
  });
}
