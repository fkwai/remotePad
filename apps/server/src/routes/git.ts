import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import type { GitFileStatus } from '@remotepad/shared';
import { resolveSafe } from '../paths.ts';

async function findRepoRoot(start: string): Promise<string | null> {
  let current = start;
  while (true) {
    try {
      const gitDir = path.join(current, '.git');
      const stat = await fs.lstat(gitDir);
      if (stat.isDirectory() || stat.isFile()) return current;
    } catch {
      // continue
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function registerGitRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { path?: string } }>('/api/git/status', async (req) => {
    const target = resolveSafe(req.query.path || os.homedir());
    const repoRoot = await findRepoRoot(target);
    if (!repoRoot) {
      return { repoRoot: null, branch: null, ahead: 0, behind: 0, files: [] };
    }
    try {
      const git = simpleGit(repoRoot);
      const status = await git.status();
      const files: GitFileStatus[] = status.files.map((file) => ({
        path: path.join(repoRoot, file.path),
        index: file.index,
        working: file.working_dir,
      }));
      return {
        repoRoot,
        branch: status.current,
        ahead: status.ahead,
        behind: status.behind,
        files,
      };
    } catch {
      return { repoRoot, branch: null, ahead: 0, behind: 0, files: [] };
    }
  });

  app.get<{ Querystring: { path?: string } }>('/api/git/diff', async (req) => {
    const target = resolveSafe(req.query.path || '');
    const repoRoot = await findRepoRoot(target);
    if (!repoRoot) return { repoRoot: '', path: target, diff: '' };
    const git = simpleGit(repoRoot);
    const rel = path.relative(repoRoot, target);
    let diff = await git.diff(['--', rel]);
    if (!diff.trim()) diff = await git.diff(['--cached', '--', rel]);
    if (!diff.trim()) {
      try {
        diff = await git.raw(['diff', '--no-index', '--', '/dev/null', rel]);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        diff = text.includes('diff --') ? text : '';
      }
    }
    return { repoRoot, path: target, diff };
  });
}
