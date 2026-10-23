import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Naming for a checkout's Helper worktree.
 *
 * Branch names are shared by every worktree of one repository, so a second
 * checkout (a dev worktree running its own instance) must not reuse `work`:
 * git refuses with "branch already used by worktree". The primary install keeps
 * the historical id; linked worktrees get a stable suffix derived from their path.
 *
 * Kept free of config imports so it can be tested without booting the server.
 */
export function workIdFor(isMainWorktree: boolean, repoRoot: string): string {
  if (isMainWorktree) return 'work';
  const hash = createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 6);
  return `work-${hash}`;
}

/** Main install keeps 2027/2028; extra checkouts get a stable pair of their own. */
export function previewPortsFor(workId: string): { port: number; uiPort: number } {
  if (workId === 'work') return { port: 2028, uiPort: 2027 };
  const n = Number.parseInt(createHash('sha1').update(workId).digest('hex').slice(0, 4), 16) % 400;
  const uiPort = 2100 + n * 2;
  return { port: uiPort + 1, uiPort };
}

/** Ask git whether this checkout is the repository's main worktree. */
export function detectWorkId(repoRoot: string): string {
  try {
    const gitDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
    const commonDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return workIdFor(path.resolve(gitDir) === path.resolve(commonDir), repoRoot);
  } catch {
    return 'work';
  }
}
