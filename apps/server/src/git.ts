import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { Repo, RepoCommit } from '@remotepad/shared';

export async function findRepoRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
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

export async function readRepoHead(repoRoot: string, name?: string, startup?: string[]): Promise<Repo> {
  const repo: Repo = {
    path: repoRoot,
    name: name || path.basename(repoRoot) || repoRoot,
    branch: null,
    ahead: 0,
    behind: 0,
    dirty: 0,
    lastCommit: null,
  };
  if (startup?.length) repo.startup = startup;
  try {
    const git = simpleGit(repoRoot);
    const [status, log] = await Promise.all([
      git.status(),
      git.log({ maxCount: 1 }),
    ]);
    repo.branch = status.current || null;
    repo.ahead = status.ahead;
    repo.behind = status.behind;
    repo.dirty = status.files.length;
    const last = log.latest;
    if (last) {
      const commit: RepoCommit = {
        hash: last.hash.slice(0, 7),
        message: (last.message || '').split('\n')[0] || '',
        author: last.author_name || '',
        date: last.date || '',
      };
      repo.lastCommit = commit;
    }
  } catch {
    // leave empty head
  }
  return repo;
}
