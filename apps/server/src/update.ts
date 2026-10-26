import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ChannelResult, ChannelStatus, UpdateResult, UpdateStatus,
} from '@remotepad/shared';

const run = promisify(execFile);

const INSTALL_FILES = ['package.json', 'pnpm-lock.yaml'];

/** Release version, read from the checkout's own package.json. */
export function readVersion(repo: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(repo, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

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

/**
 * The ref this checkout actually tracks.
 *
 * Hard-coding `origin/<branch>` broke every worktree: a preview runs on
 * `helper/nightly` while the remote branch is `nightly`, so the code looked for
 * `origin/helper/nightly`, found nothing, and the panel reported "no remote ref".
 */
export async function trackingRef(repo: string): Promise<string | null> {
  try {
    const ref = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    return ref && ref !== '@{upstream}' ? ref : null;
  } catch {
    return null;
  }
}

export type ChannelName = 'stable' | 'dev' | 'nightly';

/** Channels a runtime can follow, in promotion order. */
export const CHANNELS: Array<{ name: ChannelName; branch: string }> = [
  { name: 'stable', branch: 'main' },
  { name: 'dev', branch: 'dev' },
  { name: 'nightly', branch: 'nightly' },
];

/** What channel a branch is: the three lanes, or a feature preview. */
export function channelFor(branch: string | null): ChannelName | 'preview' | 'detached' {
  if (!branch) return 'detached';
  if (branch === 'main') return 'stable';
  if (branch === 'dev') return 'dev';
  if (branch === 'nightly') return 'nightly';
  return 'preview';
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
    repo, version: readVersion(repo), branch: null, head: null, remoteHead: null,
    behind: 0, ahead: 0, dirty: false, canUpdate: false, checkedAt,
  };

  try {
    base.branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])) || null;
    if (base.branch === 'HEAD') base.branch = null;
    base.channel = channelFor(base.branch);
    base.upstream = await trackingRef(repo);
    base.head = await git(repo, ['rev-parse', 'HEAD']);
    // Untracked files (an editor's .vscode/, build leftovers) do not block a
    // fast-forward: git refuses by itself if the merge would overwrite one. Only
    // tracked modifications can lose work, so only those count as dirty.
    base.dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])) !== '';
  } catch (err) {
    return { ...base, warning: errorText(err) };
  }

  if (!base.branch) return base;

  // Prefer the configured upstream; fall back to origin/<branch> only when the
  // branch tracks nothing (a scratch branch).
  const upstream = base.upstream || `origin/${base.branch}`;
  const remoteRef = `refs/remotes/${upstream}`;
  const remoteBranch = upstream.replace(/^[^/]+\//, '');
  const shouldFetch = options.fetch !== false;
  if (shouldFetch) {
    const last = fetchedAt.get(repo) ?? 0;
    if (options.forceFetch || Date.now() - last > FETCH_TTL_MS) {
      try {
        await git(repo, ['fetch', '--quiet', 'origin', remoteBranch], 30_000);
        fetchedAt.set(repo, Date.now());
      } catch (err) {
        base.warning = errorText(err);
      }
    }
  }

  try {
    base.remoteHead = await git(repo, ['rev-parse', '--verify', '--quiet', remoteRef]);
  } catch {
    // No upstream is a normal state for a scratch branch, not a broken install.
    return { ...base, warning: base.warning ?? `no ${upstream} — this branch tracks nothing` };
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

/**
 * What every channel currently points at, relative to this checkout.
 *
 * The user switches between lanes without touching git: `stable` is `main`,
 * `dev` collects small fixes, `nightly` is published once a day.
 */
export async function listChannels(repo: string): Promise<ChannelStatus[]> {
  const head = await git(repo, ['rev-parse', 'HEAD']).catch(() => '');
  const branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
  const out: ChannelStatus[] = [];

  for (const channel of CHANNELS) {
    const remoteRef = `refs/remotes/origin/${channel.branch}`;
    let remote: string | null = null;
    try {
      remote = await git(repo, ['rev-parse', '--verify', '--quiet', remoteRef]);
    } catch {
      out.push({ name: channel.name, branch: channel.branch, head: null, behind: 0, ahead: 0, current: branch === channel.branch });
      continue;
    }
    let behind = 0;
    let ahead = 0;
    try {
      const counts = await git(repo, ['rev-list', '--left-right', '--count', `${head}...${remote}`]);
      const [a, b] = counts.split(/\s+/).map((n) => Number(n) || 0);
      ahead = a ?? 0;
      behind = b ?? 0;
    } catch {
      // Keep zeros: the switch itself re-checks.
    }
    out.push({
      name: channel.name,
      branch: channel.branch,
      head: remote,
      behind,
      ahead,
      current: branch === channel.branch,
    });
  }
  return out;
}

/**
 * Move this checkout onto a channel.
 *
 * Refuses a dirty tree (an update must never discard work), keeps the old branch
 * head, and reports what the new code needs: a dependency install, a web rebuild
 * (done here) and a server restart.
 */
export async function switchChannel(repo: string, name: string): Promise<ChannelResult> {
  const target = CHANNELS.find((channel) => channel.name === name);
  if (!target) return { ok: false, switched: false, message: `Unknown channel: ${name}` };

  const dirty = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
    .then((out) => out !== '')
    .catch(() => true);
  if (dirty) {
    return { ok: false, switched: false, message: 'Working tree has local changes — commit or discard them first.' };
  }

  await git(repo, ['fetch', '--quiet', 'origin', target.branch], 40_000).catch(() => undefined);
  const remoteRef = `refs/remotes/origin/${target.branch}`;
  const remoteHead = await git(repo, ['rev-parse', '--verify', '--quiet', remoteRef]).catch(() => '');
  if (!remoteHead) {
    return { ok: false, switched: false, message: `origin/${target.branch} does not exist — nothing to switch to.` };
  }

  const before = await git(repo, ['rev-parse', 'HEAD']).catch(() => '');

  try {
    // A local branch of the same name is reused (it may hold local commits); the
    // merge below refuses if it cannot fast-forward.
    const hasLocal = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${target.branch}`])
      .then(() => true)
      .catch(() => false);
    if (hasLocal) {
      await git(repo, ['checkout', '--quiet', target.branch], 40_000);
    } else {
      await git(repo, ['checkout', '--quiet', '-b', target.branch, '--track', `origin/${target.branch}`], 40_000);
    }
    await git(repo, ['merge', '--ff-only', '--quiet', `origin/${target.branch}`], 60_000);
  } catch (err) {
    // Put the checkout back where it was: a failed switch must not strand it.
    if (before) await git(repo, ['checkout', '--quiet', before], 40_000).catch(() => undefined);
    return { ok: false, switched: false, message: errorText(err) };
  }

  const after = await git(repo, ['rev-parse', 'HEAD']).catch(() => '');
  const changed = await git(repo, ['diff', '--name-only', `${before}..${after}`]).catch(() => '');
  const impact = classifyChanges(changed.split('\n'));

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
    switched: before !== after,
    channel: target.name,
    head: after,
    needsInstall: impact.needsInstall,
    needsBuild: impact.needsBuild,
    needsRestart: impact.needsRestart,
    built,
    buildError,
    message: notes.length ? `Now on ${target.name} — ${notes.join(', ')}.` : `Now on ${target.name}.`,
    status: await readUpdateStatus(repo, { fetch: false }),
  };
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
