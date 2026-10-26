import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { applyUpdate, classifyChanges, readUpdateStatus } from '../../apps/server/src/update.ts';

/**
 * The update button is only safe if the git plumbing refuses to lose work.
 * These tests run the real module against throwaway repositories — no browser,
 * no network.
 */

interface Fixture {
  dir: string;
  remote: string;
  seed: string;
  consumer: string;
  git: (cwd: string, ...args: string[]) => string;
  pushCommit: (name: string, body: string) => void;
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-update-'));
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  const consumer = path.join(dir, 'consumer');
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
  execFileSync('git', ['clone', '-q', remote, consumer]);

  const pushCommit = (name: string, body: string) => {
    fs.writeFileSync(path.join(seed, name), body);
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', `add ${name}`);
    git(seed, 'push', '-q', 'origin', 'main');
  };

  return { dir, remote, seed, consumer, git, pushCommit };
}

test.describe('git update module', () => {
  test('reports how far behind origin the checkout is', async () => {
    const f = makeFixture();
    f.pushCommit('two.txt', 'two\n');
    f.pushCommit('three.txt', 'three\n');

    const status = await readUpdateStatus(f.consumer, { fetch: true, forceFetch: true });
    expect(status.branch).toBe('main');
    expect(status.behind).toBe(2);
    expect(status.ahead).toBe(0);
    expect(status.dirty).toBe(false);
    expect(status.canUpdate).toBe(true);
    expect(status.head).toBe(f.git(f.consumer, 'rev-parse', 'HEAD'));
    expect(status.remoteHead).toBe(f.git(f.seed, 'rev-parse', 'HEAD'));
  });

  test('fast-forwards a clean checkout and reports the new head', async () => {
    const f = makeFixture();
    f.pushCommit('two.txt', 'two\n');

    const result = await applyUpdate(f.consumer);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.head).toBe(f.git(f.seed, 'rev-parse', 'HEAD'));
    expect(fs.existsSync(path.join(f.consumer, 'two.txt'))).toBe(true);

    const after = await readUpdateStatus(f.consumer, { fetch: false });
    expect(after.behind).toBe(0);
    expect(after.canUpdate).toBe(false);
  });

  test('flags a dependency install when package.json moves', async () => {
    const f = makeFixture();
    f.pushCommit('package.json', '{"name":"fixture"}\n');

    const result = await applyUpdate(f.consumer);
    expect(result.updated).toBe(true);
    expect(result.needsInstall).toBe(true);
    expect(result.message).toMatch(/install/i);
  });

  test('refuses to update a dirty tree', async () => {
    const f = makeFixture();
    f.pushCommit('two.txt', 'two\n');
    fs.writeFileSync(path.join(f.consumer, 'README.md'), 'local edit\n');

    const status = await readUpdateStatus(f.consumer, { fetch: true, forceFetch: true });
    expect(status.dirty).toBe(true);
    expect(status.canUpdate).toBe(false);

    const result = await applyUpdate(f.consumer);
    expect(result.ok).toBe(false);
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/local changes/i);
    // The edit survives.
    expect(fs.readFileSync(path.join(f.consumer, 'README.md'), 'utf8')).toBe('local edit\n');
  });

  test('an untracked file does not block the update', async () => {
    const f = makeFixture();
    f.pushCommit('two.txt', 'two\n');
    fs.mkdirSync(path.join(f.consumer, '.vscode'));
    fs.writeFileSync(path.join(f.consumer, '.vscode', 'settings.json'), '{}\n');

    const status = await readUpdateStatus(f.consumer, { fetch: true, forceFetch: true });
    expect(status.dirty).toBe(false);
    expect(status.canUpdate).toBe(true);

    const result = await applyUpdate(f.consumer);
    expect(result.updated).toBe(true);
    // The untracked file survives the fast-forward.
    expect(fs.existsSync(path.join(f.consumer, '.vscode', 'settings.json'))).toBe(true);
  });

  test('refuses when the local branch has unpublished commits', async () => {
    const f = makeFixture();
    f.pushCommit('two.txt', 'two\n');
    fs.writeFileSync(path.join(f.consumer, 'local.txt'), 'mine\n');
    f.git(f.consumer, 'add', '-A');
    f.git(f.consumer, 'commit', '-qm', 'local work');

    const status = await readUpdateStatus(f.consumer, { fetch: true, forceFetch: true });
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.canUpdate).toBe(false);

    const result = await applyUpdate(f.consumer);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ahead/i);
    expect(fs.existsSync(path.join(f.consumer, 'local.txt'))).toBe(true);
  });

  test('is a no-op when already up to date', async () => {
    const f = makeFixture();
    const status = await readUpdateStatus(f.consumer, { fetch: true, forceFetch: true });
    expect(status.behind).toBe(0);

    const result = await applyUpdate(f.consumer);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/up to date/i);
  });
});

test.describe('change classification', () => {
  test('maps a pulled range to install / build / restart work', () => {
    expect(classifyChanges(['README.md'])).toMatchObject({
      needsInstall: false, needsBuild: false, needsRestart: false,
    });
    expect(classifyChanges(['pnpm-lock.yaml', 'apps/web/src/App.tsx'])).toMatchObject({
      needsInstall: true, needsBuild: true, needsRestart: false,
    });
    expect(classifyChanges(['apps/server/src/index.ts'])).toMatchObject({
      needsInstall: false, needsBuild: false, needsRestart: true,
    });
    expect(classifyChanges(['packages/shared/src/index.ts'])).toMatchObject({
      needsBuild: true, needsRestart: false,
    });
    // Blank lines from `git diff --name-only` must not trip the flags.
    expect(classifyChanges(['', '  ', 'docs/x.md'])).toMatchObject({
      files: ['docs/x.md'], needsInstall: false, needsBuild: false, needsRestart: false,
    });
  });
});
