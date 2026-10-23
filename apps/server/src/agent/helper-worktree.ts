import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { detectWorkId, previewPortsFor } from './worktree-id.ts';

const execFileAsync = promisify(execFile);

const WT_ROOT = path.join(os.homedir(), '.remotepad', 'helper-worktrees');
const PREVIEW_LOG = path.join(os.homedir(), '.remotepad', 'helper-preview.log');

const WORK_ID = detectWorkId(config.repoRoot);
const PREVIEW_PORTS = previewPortsFor(WORK_ID);

export type HelperWorktreeInfo = {
  path: string;
  branch: string;
  port: number;
  uiPort: number;
};

export function helperBranchName(_sessionId?: string): string {
  return `helper/${WORK_ID}`;
}

export function helperWorktreePath(_sessionId?: string): string {
  return path.join(WT_ROOT, WORK_ID);
}

export function helperPreviewPorts(): { port: number; uiPort: number } {
  return { ...PREVIEW_PORTS };
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

async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  try {
    await git(repo, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

function writePreviewSettings(wtPath: string): void {
  const fp = path.join(wtPath, 'settings.json');
  const ports = helperPreviewPorts();
  const body = { host: config.host, port: ports.port, uiPort: ports.uiPort };
  try {
    if (fs.existsSync(fp)) {
      const cur = JSON.parse(fs.readFileSync(fp, 'utf8')) as Record<string, unknown>;
      if (cur.port === ports.port && cur.uiPort === ports.uiPort && cur.host === body.host) return;
    }
  } catch { /* rewrite */ }
  fs.writeFileSync(fp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

/**
 * The preview window must open the same files as the live window, but pointing
 * at the worktree instead of the live install. Session state is a flat JSON of
 * absolute paths, so every path under the live root is rebased onto the tree.
 */
function seedSessionFromLive(wtPath: string, force: boolean): void {
  const liveSess = path.join(config.repoRoot, 'tmp', 'session.json');
  const wtSess = path.join(wtPath, 'tmp', 'session.json');
  try {
    if (!fs.existsSync(liveSess)) return;
    if (!force && fs.existsSync(wtSess)) return;
    const liveRoot = path.resolve(config.repoRoot);
    const rebase = (value: unknown): unknown => {
      if (typeof value === 'string') {
        if (value === liveRoot || value.startsWith(`${liveRoot}/`)) {
          return wtPath + value.slice(liveRoot.length);
        }
        return value;
      }
      if (Array.isArray(value)) return value.map(rebase);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rebase(v);
        return out;
      }
      return value;
    };
    const state = rebase(JSON.parse(fs.readFileSync(liveSess, 'utf8')));
    fs.mkdirSync(path.dirname(wtSess), { recursive: true });
    fs.writeFileSync(wtSess, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch { /* preview just opens with its own last session */ }
}

/**
 * Ensures the one Helper worktree (~/.remotepad/helper-worktrees/work on
 * branch helper/work). Reused for every edit until it is merged and deleted.
 * The live install (config.repoRoot) is never the Helper cwd.
 */
export async function ensureHelperWorktree(_sessionId?: string): Promise<HelperWorktreeInfo> {
  const live = path.resolve(config.repoRoot);
  const wtPath = helperWorktreePath();
  const branch = helperBranchName();
  const ports = helperPreviewPorts();
  fs.mkdirSync(WT_ROOT, { recursive: true });

  const exists = fs.existsSync(wtPath);
  if (exists) {
    try {
      const top = await git(wtPath, ['rev-parse', '--show-toplevel']);
      if (path.resolve(top) === path.resolve(wtPath)) {
        const cur = await git(wtPath, ['branch', '--show-current']).catch(() => '');
        writePreviewSettings(wtPath);
        seedSessionFromLive(wtPath, false);
        return {
          path: wtPath,
          branch: cur || branch,
          port: ports.port,
          uiPort: ports.uiPort,
        };
      }
    } catch {
      // stale directory, fall through and recreate
    }
  }

  // Drop a stale/broken tree before recreating it.
  if (fs.existsSync(wtPath)) {
    await git(live, ['worktree', 'remove', '--force', wtPath]).catch(() => undefined);
    if (fs.existsSync(wtPath)) fs.rmSync(wtPath, { recursive: true, force: true });
    await git(live, ['worktree', 'prune']).catch(() => undefined);
  }

  const hasBranch = (await git(live, ['branch', '--list', branch]).catch(() => '')).includes(branch);
  const base = (await git(live, ['branch', '--list', 'main']).catch(() => '')).includes('main') ? 'main' : 'HEAD';
  if (hasBranch) {
    await git(live, ['worktree', 'add', wtPath, branch]);
  } else {
    await git(live, ['worktree', 'add', '-b', branch, wtPath, base]);
  }

  writePreviewSettings(wtPath);
  seedSessionFromLive(wtPath, false);
  return { path: wtPath, branch, port: ports.port, uiPort: ports.uiPort };
}

/**
 * Removes a Helper worktree. The shared worktree is only removed by the merge
 * sweep, so deleting a chat tab never throws away unmerged work.
 */
export async function removeHelperWorktree(sessionId?: string): Promise<void> {
  const live = path.resolve(config.repoRoot);
  const shared = helperWorktreePath();
  const target = path.join(WT_ROOT, (sessionId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (path.resolve(target) === path.resolve(shared)) return;
  try {
    await git(live, ['worktree', 'remove', '--force', target], { timeout: 30_000 });
  } catch {
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
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

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

let previewProc: ChildProcess | null = null;

export type PreviewResult = { ok: boolean; message: string; url: string };

/**
 * Starts (or reports) the worktree preview on the fixed ports. It runs a full
 * second instance of RemotePad from the worktree, so the files, tabs and
 * git state on screen are the Helper's, not the live install's.
 */
export async function startHelperPreview(sessionId: string): Promise<PreviewResult> {
  const info = await ensureHelperWorktree(sessionId);
  const url = `http://${config.host}:${PREVIEW_PORTS.uiPort}/`;
  seedSessionFromLive(info.path, true);

  const running = previewProc && !previewProc.killed;
  if (running || (await portOpen(PREVIEW_PORTS.uiPort))) {
    return { ok: true, message: `Preview already running at ${url}`, url };
  }

  if (!fs.existsSync(path.join(info.path, 'node_modules'))) {
    try {
      await execFileAsync('pnpm', ['install', '--frozen-lockfile'], {
        cwd: info.path,
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `pnpm install failed in the worktree: ${text}`, url };
    }
  }

  try {
    const out = fs.openSync(PREVIEW_LOG, 'a');
    const child = spawn('pnpm', ['dev'], {
      cwd: info.path,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, REMOTEPAD_PREVIEW: '1' },
    });
    child.unref();
    previewProc = child;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not start the preview: ${text}`, url };
  }

  for (let i = 0; i < 60; i++) {
    if (await portOpen(PREVIEW_PORTS.uiPort)) {
      return { ok: true, message: `Preview up at ${url} (worktree: ${info.path})`, url };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    ok: false,
    message: `Preview did not answer on ${PREVIEW_PORTS.uiPort} yet. Log: ${PREVIEW_LOG}`,
    url,
  };
}

/** Stops the preview instance (its port returns to the OS). */
export async function stopHelperPreview(): Promise<void> {
  const child = previewProc;
  previewProc = null;
  if (child && !child.killed && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch { /* already gone */ }
    }
  }
  const wtPath = helperWorktreePath();
  try {
    await execFileAsync('pkill', ['-f', wtPath], { timeout: 10_000 });
  } catch { /* nothing matched */ }
}

export type MergeResult = {
  ok: boolean;
  message: string;
  hash?: string;
  removed?: string[];
};

async function sweepMergedWorktrees(live: string, mainBranch: string, keep: string[]): Promise<string[]> {
  const removed: string[] = [];
  const raw = await git(live, ['worktree', 'list', '--porcelain']).catch(() => '');
  const entries = raw
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const wt = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length) ?? '';
      const br = lines.find((l) => l.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? '';
      return { path: wt, branch: br };
    })
    .filter((e) => e.path && path.resolve(e.path) !== path.resolve(live));

  for (const entry of entries) {
    if (keep.some((k) => path.resolve(k) === path.resolve(entry.path))) continue;
    if (!path.resolve(entry.path).startsWith(WT_ROOT)) continue;
    if (!entry.branch || entry.branch === mainBranch) continue;
    if (!(await isAncestor(live, entry.branch, mainBranch))) continue;
    const dirty = await git(entry.path, ['status', '--porcelain']).catch(() => 'x');
    if (dirty) continue;
    try {
      await git(live, ['worktree', 'remove', '--force', entry.path], { timeout: 30_000 });
    } catch {
      if (fs.existsSync(entry.path)) fs.rmSync(entry.path, { recursive: true, force: true });
    }
    await git(live, ['branch', '-d', entry.branch]).catch(() => undefined);
    removed.push(entry.path);
  }
  await git(live, ['worktree', 'prune']).catch(() => undefined);
  return removed;
}

/**
 * One-key finish: commit + push the helper branch, merge it into main in the
 * live install, then delete the worktree (and any other merged helper tree)
 * and stop the preview instance.
 */
export async function mergeHelperIntoMain(sessionId: string): Promise<MergeResult> {
  const live = path.resolve(config.repoRoot);
  if (live.startsWith(WT_ROOT)) {
    return { ok: false, message: 'Merge from the live window, not from a preview instance.' };
  }

  const mainBranch = await git(live, ['branch', '--show-current']).catch(() => '');
  if (mainBranch !== 'main' && mainBranch !== 'master') {
    return { ok: false, message: `Live install is on "${mainBranch || '(detached)'}", expected main.` };
  }

  const wtPath = helperWorktreePath();
  const hasTree = fs.existsSync(wtPath);
  const branch = hasTree ? await git(wtPath, ['branch', '--show-current']).catch(() => '') : '';

  if (hasTree) {
    if (!branch || branch === mainBranch) {
      return { ok: false, message: `Helper worktree is on "${branch || '(detached)'}" — nothing to merge.` };
    }

    const pub = await publishHelperWorktree(sessionId);
    if (!pub.ok && !pub.committed) {
      return { ok: false, message: pub.message };
    }

    let merged = true;
    try {
      await git(live, ['merge', '--ff-only', branch], { timeout: 120_000 });
    } catch {
      try {
        await git(live, ['merge', '--no-ff', '-m', `Merge ${branch} into ${mainBranch}`, branch], { timeout: 120_000 });
      } catch (err) {
        await git(live, ['merge', '--abort']).catch(() => undefined);
        const text = err instanceof Error ? err.message : String(err);
        merged = false;
        return { ok: false, message: `Merge conflict, nothing applied: ${text}` };
      }
    }
    if (!merged) return { ok: false, message: 'Merge failed.' };
  }

  await stopHelperPreview();

  const removed = await sweepMergedWorktrees(live, mainBranch, []);
  const hash = await git(live, ['rev-parse', '--short', 'HEAD']).catch(() => '');
  const cleaned = removed.length
    ? `deleted ${removed.length} merged worktree${removed.length === 1 ? '' : 's'}`
    : 'no worktree left to delete';

  if (!hasTree) {
    return { ok: true, message: `Nothing to merge. ${cleaned}. main at ${hash}.`, hash, removed };
  }

  return {
    ok: true,
    message: `Merged ${branch} into ${mainBranch} (${hash}), ${cleaned}, preview stopped.`,
    hash,
    removed,
  };
}
