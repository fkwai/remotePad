import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

const WT_ROOT = path.join(os.homedir(), '.remotepad', 'helper-worktrees');

export type HelperWorktreeInfo = {
  path: string;
  branch: string;
  port: number;
  uiPort: number;
};

function safeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function helperBranchName(sessionId: string): string {
  return `helper/${safeId(sessionId)}`;
}

export function helperWorktreePath(sessionId: string): string {
  return path.join(WT_ROOT, safeId(sessionId));
}

/** Stable preview ports per Helper session (away from live 3847/5173). */
export function helperPreviewPorts(sessionId: string): { port: number; uiPort: number } {
  let h = 0;
  for (const ch of sessionId) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const n = h % 40;
  return { port: 3900 + n, uiPort: 5300 + n };
}

async function git(cwd: string, args: string[], opts?: { timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: opts?.timeout ?? 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout ?? '').trim();
}

function writePreviewSettings(wtPath: string, ports: { port: number; uiPort: number }): void {
  const fp = path.join(wtPath, 'settings.json');
  const body = {
    host: config.host,
    port: ports.port,
    uiPort: ports.uiPort,
  };
  try {
    if (fs.existsSync(fp)) {
      const cur = JSON.parse(fs.readFileSync(fp, 'utf8')) as Record<string, unknown>;
      if (cur.port === ports.port && cur.uiPort === ports.uiPort) return;
    }
  } catch { /* rewrite */ }
  fs.writeFileSync(fp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

/**
 * Ensures a dedicated git worktree for this Helper session under
 * ~/.remotepad/helper-worktrees/<id>, on branch helper/<id>.
 * Live install (config.repoRoot) is never the Helper cwd.
 */
export async function ensureHelperWorktree(sessionId: string): Promise<HelperWorktreeInfo> {
  const live = path.resolve(config.repoRoot);
  const wtPath = helperWorktreePath(sessionId);
  const branch = helperBranchName(sessionId);
  const ports = helperPreviewPorts(sessionId);
  fs.mkdirSync(WT_ROOT, { recursive: true });

  const already = fs.existsSync(path.join(wtPath, '.git')) || fs.existsSync(wtPath);
  if (already) {
    try {
      const top = await git(wtPath, ['rev-parse', '--show-toplevel']);
      if (path.resolve(top) === path.resolve(wtPath)) {
        // Keep branch checked out if we can.
        const cur = await git(wtPath, ['branch', '--show-current']).catch(() => '');
        if (cur && cur !== branch) {
          try {
            await git(wtPath, ['checkout', '-B', branch]);
          } catch { /* stay on current */ }
        }
        writePreviewSettings(wtPath, ports);
        return { path: wtPath, branch: cur || branch, port: ports.port, uiPort: ports.uiPort };
      }
    } catch {
      // fall through to recreate
    }
  }

  if (fs.existsSync(wtPath)) {
    fs.rmSync(wtPath, { recursive: true, force: true });
  }

  // Prefer existing local branch; else create from live HEAD.
  const localBranches = await git(live, ['branch', '--list', branch]).catch(() => '');
  if (localBranches.includes(branch)) {
    await git(live, ['worktree', 'add', wtPath, branch]);
  } else {
    await git(live, ['worktree', 'add', '-b', branch, wtPath, 'HEAD']);
  }

  writePreviewSettings(wtPath, ports);
  return { path: wtPath, branch, port: ports.port, uiPort: ports.uiPort };
}

export async function removeHelperWorktree(sessionId: string): Promise<void> {
  const live = path.resolve(config.repoRoot);
  const wtPath = helperWorktreePath(sessionId);
  try {
    await git(live, ['worktree', 'remove', '--force', wtPath], { timeout: 30_000 });
  } catch {
    try {
      if (fs.existsSync(wtPath)) fs.rmSync(wtPath, { recursive: true, force: true });
      await git(live, ['worktree', 'prune']).catch(() => undefined);
    } catch { /* ignore */ }
  }
}

export type PublishResult = {
  ok: boolean;
  message: string;
  branch?: string;
  committed?: boolean;
  pushed?: boolean;
  hash?: string;
};

/**
 * One-key publish: stage all, commit if dirty, push branch to origin.
 * Never force-push. Never touches main.
 */
export async function publishHelperWorktree(sessionId: string): Promise<PublishResult> {
  const info = await ensureHelperWorktree(sessionId);
  const cwd = info.path;
  const branch = (await git(cwd, ['branch', '--show-current']).catch(() => info.branch)) || info.branch;

  if (!branch || branch === 'main' || branch === 'master') {
    return { ok: false, message: `Refusing to publish branch "${branch || '(detached)'}". Helper only pushes helper/* branches.` };
  }

  const status = await git(cwd, ['status', '--porcelain']);
  let committed = false;
  let hash = '';

  if (status) {
    await git(cwd, ['add', '-A']);
    const summary = status.split('\n').filter(Boolean).slice(0, 8).map((line) => line.trim()).join(', ');
    const msg = `Helper ${sessionId}: ${summary}`;
    try {
      await git(cwd, ['commit', '-m', msg]);
      committed = true;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (!/nothing to commit/i.test(text)) {
        return { ok: false, message: `Commit failed: ${text}`, branch };
      }
    }
  }

  hash = await git(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => '');

  try {
    await git(cwd, ['push', '-u', 'origin', 'HEAD'], { timeout: 120_000 });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: committed
        ? `Committed ${hash} on ${branch}, but push failed: ${text}`
        : `Push failed: ${text}`,
      branch,
      committed,
      pushed: false,
      hash: hash || undefined,
    };
  }

  if (!committed && !status) {
    return {
      ok: true,
      message: `Nothing new to commit. Pushed ${branch}${hash ? ` (${hash})` : ''} to origin.`,
      branch,
      committed: false,
      pushed: true,
      hash: hash || undefined,
    };
  }

  return {
    ok: true,
    message: committed
      ? `Committed and pushed ${branch}${hash ? ` (${hash})` : ''} to origin.`
      : `Pushed ${branch}${hash ? ` (${hash})` : ''} to origin.`,
    branch,
    committed,
    pushed: true,
    hash: hash || undefined,
  };
}
