import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { listPreviews, previewsDir } from '../../apps/server/src/previews.ts';

/** `GET /api/previews` reads what preview.sh left on disk. */

function writePreview(repo: string, name: string, ui: number, api?: number) {
  const dir = path.join(repo, '.previews', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ui'), `${ui}\n`);
  if (api) fs.writeFileSync(path.join(dir, 'api'), `${api}\n`);
}

test.describe('previews dir', () => {
  test('a worktree resolves to the main checkout, where preview.sh writes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-wt-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com',
        GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com',
      },
    }).trim();

    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    git('add', '-A');
    git('commit', '-qm', 'init');
    const wt = path.join(dir, 'wt');
    git('worktree', 'add', '-q', wt, '-b', 'helper/demo');

    expect(previewsDir(dir)).toBe(path.join(dir, '.previews'));
    expect(previewsDir(wt)).toBe(path.join(dir, '.previews'));
  });
});

function listen(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

test.describe('preview list', () => {
  test('an empty install reports none', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-prev-'));
    expect(await listPreviews(repo)).toEqual([]);
  });

  test('reports ports and whether the preview answers', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-prev-'));
    const live = await listen();
    const dead = await listen();
    const deadPort = dead.port;
    dead.close();

    writePreview(repo, 'feature-a', live.port, live.port + 1);
    writePreview(repo, 'feature-b', deadPort);

    const list = await listPreviews(repo);
    expect(list.map((item) => item.name)).toEqual(['feature-a', 'feature-b']);
    expect(list[0]).toMatchObject({ uiPort: live.port, apiPort: live.port + 1, alive: true });
    expect(list[1]).toMatchObject({ uiPort: deadPort, alive: false });

    live.close();
  });

  test('ignores folders without a port file and malformed values', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-prev-'));
    fs.mkdirSync(path.join(repo, '.previews', 'half'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.previews', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.previews', 'junk', 'ui'), 'not-a-port\n');

    expect(await listPreviews(repo)).toEqual([]);
  });
});
