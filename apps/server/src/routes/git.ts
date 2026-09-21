import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import type { GitFileStatus } from '@remotepad/shared';
import { findRepoRoot } from '../git.ts';
import { resolveSafe } from '../paths.ts';

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

  app.post<{ Body: { path?: string } }>('/api/git/restore', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    const repoRoot = await findRepoRoot(target);
    if (!repoRoot) return { ok: false, error: 'Not a git repository' };
    const git = simpleGit(repoRoot);
    const rel = path.relative(repoRoot, target);
    if (!rel || rel.startsWith('..')) return { ok: false, error: 'Path outside repository' };
    try {
      await git.checkout(['--', rel]);
      return { ok: true, path: target, repoRoot };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}
