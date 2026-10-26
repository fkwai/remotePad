import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { channelFor, listChannels, readUpdateStatus, trackingRef } from '../../apps/server/src/update.ts';

/**
 * Lanes and the ref a checkout actually tracks.
 *
 * The bug this guards: a preview runs on `helper/nightly` while the remote branch
 * is `nightly`, and the status looked for `origin/helper/nightly`, found nothing
 * and reported "no remote ref" next to a correct commit.
 */
function fixture(): { dir: string; remote: string; seed: string; git: (cwd: string, ...args: string[]) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lane-'));
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com',
        GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com',
      },
    }).trim();

  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, seed]);
  fs.writeFileSync(path.join(seed, 'README.md'), 'one\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'initial');
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  // A `nightly` lane on the remote.
  git(seed, 'checkout', '-q', '-b', 'nightly');
  fs.writeFileSync(path.join(seed, 'nightly.txt'), 'n\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'nightly work');
  git(seed, 'push', '-q', '-u', 'origin', 'nightly');
  git(seed, 'checkout', '-q', 'main');

  return { dir, remote, seed, git };
}

test.describe('channels', () => {
  test('branch names map to lanes', () => {
    expect(channelFor('main')).toBe('stable');
    expect(channelFor('dev')).toBe('dev');
    expect(channelFor('nightly')).toBe('nightly');
    expect(channelFor('helper/nightly')).toBe('preview');
    expect(channelFor(null)).toBe('detached');
  });

  test('a worktree branch reads as the lane it tracks', () => {
    // This is what the nightly preview runs: local `helper/nightly`, remote
    // `nightly`. The badge must say nightly, not "preview".
    expect(channelFor('helper/nightly', 'origin/nightly')).toBe('nightly');
    expect(channelFor('helper/stable-preview', 'origin/main')).toBe('stable');
    expect(channelFor('helper/dev-preview', 'origin/dev')).toBe('dev');
    expect(channelFor('helper/fs-copy', 'origin/helper/fs-copy')).toBe('preview');
  });

  test('reports the upstream instead of guessing origin/<branch>', async () => {
    const f = fixture();
    const consumer = path.join(f.dir, 'consumer');
    // A worktree-style branch: local name differs from the remote branch.
    execFileSync('git', ['clone', '-q', f.remote, consumer]);
    f.git(consumer, 'checkout', '-q', '-b', 'helper/preview-name', '--track', 'origin/nightly');

    expect(await trackingRef(consumer)).toBe('origin/nightly');

    const status = await readUpdateStatus(consumer, { fetch: true, forceFetch: true });
    expect(status.branch).toBe('helper/preview-name');
    expect(status.upstream).toBe('origin/nightly');
    expect(status.channel).toBe('nightly');
    expect(status.behind).toBe(0);
    expect(status.remoteHead).toBe(f.git(f.seed, 'rev-parse', 'nightly'));
    // The old code produced this warning for a perfectly healthy branch.
    expect(status.warning).toBeUndefined();
  });

  test('a branch with no upstream says so without pretending to be broken', async () => {
    const f = fixture();
    const consumer = path.join(f.dir, 'scratch');
    execFileSync('git', ['clone', '-q', f.remote, consumer]);
    f.git(consumer, 'checkout', '-q', '-b', 'scratch');

    const status = await readUpdateStatus(consumer, { fetch: false });
    expect(status.upstream).toBeNull();
    expect(status.canUpdate).toBe(false);
    expect(status.warning).toMatch(/tracks nothing/);
  });

  test('lists each lane with its distance from here', async () => {
    const f = fixture();
    const consumer = path.join(f.dir, 'consumer2');
    execFileSync('git', ['clone', '-q', f.remote, consumer]);

    const lanes = await listChannels(consumer);
    expect(lanes.map((lane) => lane.name)).toEqual(['stable', 'dev', 'nightly']);

    const stable = lanes.find((lane) => lane.name === 'stable')!;
    const nightly = lanes.find((lane) => lane.name === 'nightly')!;
    const dev = lanes.find((lane) => lane.name === 'dev')!;

    expect(stable.current).toBe(true);
    expect(stable.behind).toBe(0);
    expect(nightly.current).toBe(false);
    // Nightly is one commit ahead of main.
    expect(nightly.behind).toBe(1);
    // dev does not exist on the remote yet.
    expect(dev.head).toBeNull();
  });
});
