import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UpdateResult, UpdateStatus } from '@remotepad/shared';

const run = promisify(execFile);

const INSTALL_FILES = ['package.json', 'pnpm-lock.yaml'];

export interface ChangeImpact {
  files: string[];
  needsInstall: boolean;
  /** Web sources changed: the served dist must be rebuilt. */
  needsBuild: boolean;
  /** Server sources changed: the process must restart. */
  needsRestart: boolean;
}

/** What a pulled range implies for a running install. */
export function classifyChanges(files: string[]): ChangeImpact {
  const clean = files.map((file) => file.trim()).filter(Boolean);
  return {
    files: clean,
    needsInstall: clean.some((file) => INSTALL_FILES.includes(file)),
    needsBuild: clean.some((file) => file.startsWith('apps/web/') || file.startsWith('packages/shared/')),
    needsRestart: clean.some((file) => file.startsWith('apps/server/')),
  };
}

async function rebuildWeb(repo: string) {
  const vite = `${repo}/apps/web/node_modules/.bin/vite`;
  await run(vite, ['build'], {
    cwd: `${repo}/apps/web`,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: '1' },
  });
}

async function git(repo: string, args: string[], timeout = 20_000) {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

/** One fetch per repo per window keeps GET /api/update cheap enough to poll. */
const fetchedAt = new Map<string, number>();
const FETCH_TTL_MS = 30_000;

export interface UpdateOptions {
  /** Skip `git fetch` (offline / tests). */
  fetch?: boolean;
  /** Force a fetch even if the cache window has not elapsed. */
  forceFetch?: boolean;
}

export async function readUpdateStatus(repo: string, options: UpdateOptions = {}): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();
  const base: UpdateStatus = {
    repo, branch: null, head: null, remoteHead: null, behind: 0, ahead: 0,
    dirty: false, canUpdate: false, checkedAt,
  };

  try {
    base.branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])) || null;
    if (base.branch === 'HEAD') base.branch = null;
    base.head = await git(repo, ['rev-parse', 'HEAD']);
    base.dirty = (await git(repo, ['status', '--porcelain'])) !== '';
  } catch (err) {
    return { ...base, warning: errorText(err) };
  }

  if (!base.branch) return base;

  const remoteRef = `refs/remotes/origin/${base.branch}`;
  const shouldFetch = options.fetch !== false;
  if (shouldFetch) {
    const last = fetchedAt.get(repo) ?? 0;
    if (options.forceFetch || Date.now() - last > FETCH_TTL_MS) {
      try {
        await git(repo, ['fetch', '--quiet', 'origin', base.branch], 30_000);
        fetchedAt.set(repo, Date.now());
      } catch (err) {
        base.warning = errorText(err);
      }
    }
  }

  try {
    base.remoteHead = await git(repo, ['rev-parse', '--verify', '--quiet', remoteRef]);
  } catch {
    return { ...base, warning: base.warning ?? `no ${remoteRef} — remote not fetched yet` };
  }

  try {
    const counts = await git(repo, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
    const [ahead, behind] = counts.split(/\s+/).map((n) => Number(n) || 0);
    base.ahead = ahead;
    base.behind = behind;
  } catch (err) {
    return { ...base, warning: errorText(err) };
  }

  base.canUpdate = base.behind > 0 && base.ahead === 0 && !base.dirty;
  return base;
}

/**
 * Fast-forward to origin/<branch>. Only touches a clean tree with no local
 * commits, so a running runtime can never lose work — it refuses otherwise and
 * says why.
 */
export async function applyUpdate(repo: string): Promise<UpdateResult> {
  const status = await readUpdateStatus(repo, { fetch: true, forceFetch: true });
  if (status.warning && !status.remoteHead) {
    return { ok: false, updated: false, message: status.warning, status };
  }
  if (status.dirty) {
    return { ok: false, updated: false, message: 'Working tree has local changes — commit or discard them first.', status };
  }
  if (status.ahead > 0) {
    return { ok: false, updated: false, message: `Local branch is ahead by ${status.ahead} commit(s) — merge them before updating.`, status };
  }
  if (status.behind === 0) {
    return { ok: true, updated: false, message: 'Already up to date.', status };
  }
  if (!status.branch) {
    return { ok: false, updated: false, message: 'Detached HEAD — check out a branch first.', status };
  }

  const before = status.head;
  try {
    await git(repo, ['merge', '--ff-only', `origin/${status.branch}`], 60_000);
    const after = await git(repo, ['rev-parse', 'HEAD']);
    const changed = await git(repo, ['diff', '--name-only', `${before}..${after}`]).catch(() => '');
    const impact = classifyChanges(changed.split('\n'));

    // A dist-serving install would otherwise reload into the old bundle.
    let built = false;
    let buildError: string | undefined;
    if (impact.needsBuild) {
      try {
        await rebuildWeb(repo);
        built = true;
      } catch (err) {
        buildError = errorText(err);
      }
    }

    const notes: string[] = [];
    if (impact.needsInstall) notes.push('install dependencies');
    if (impact.needsRestart) notes.push('restart RemotePad for server changes');
    if (impact.needsBuild && !built) notes.push('rebuild the web app');

    return {
      ok: true,
      updated: before !== after,
      head: after,
      needsInstall: impact.needsInstall,
      needsBuild: impact.needsBuild,
      needsRestart: impact.needsRestart,
      built,
      buildError,
      message: notes.length ? `Updated — ${notes.join(', ')}.` : 'Updated.',
      status: await readUpdateStatus(repo, { fetch: false }),
    };
  } catch (err) {
    return { ok: false, updated: false, message: errorText(err), status };
  }
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: string; message?: string };
    const text = (e.stderr || e.message || '').trim();
    // execFile errors repeat the command; keep the useful tail.
    return text.split('\n').slice(-2).join(' ').slice(0, 300) || 'git failed';
  }
  return String(err).slice(0, 300);
}
