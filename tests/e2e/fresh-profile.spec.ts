import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * A brand-new profile: no `~/.remotepad` files at all.
 *
 * The e2e HOME is created empty on every run, which is exactly the state of a
 * preview instance or a fresh machine. The bug this guards: opening the repos
 * control file returned 500 with a raw `ENOENT … stat` message in the toast.
 */
test.describe('fresh profile', () => {
  test('the repos control file exists and opens', async ({ page }) => {
    await gotoApp(page);

    const listed = await (await page.request.get('/api/repos')).json() as {
      repos: unknown[]; controlPath: string;
    };
    expect(listed.controlPath).toContain('.remotepad/workspaces.json');
    expect(fs.existsSync(listed.controlPath)).toBe(true);

    const read = await page.request.get(`/api/fs/read?path=${encodeURIComponent(listed.controlPath)}`);
    expect(read.status()).toBe(200);
    expect(JSON.parse((await read.json() as { content: string }).content)).toEqual({ folders: [] });
  });

  test('a missing path answers 404 with a readable message, not a stack', async ({ page }) => {
    await gotoApp(page);

    for (const endpoint of ['/api/fs/read', '/api/fs/raw', '/api/fs/list']) {
      const res = await page.request.get(`${endpoint}?path=${encodeURIComponent('/nope/missing.txt')}`);
      expect(res.status(), endpoint).toBe(404);
      const body = await res.text();
      expect(body, endpoint).not.toContain('ENOENT');
      expect(body.toLowerCase(), endpoint).toContain('not found');
    }
  });

  test('the control file sits inside the test HOME, never the real one', async ({ page }) => {
    await gotoApp(page);
    const listed = await (await page.request.get('/api/repos')).json() as { controlPath: string };
    expect(path.basename(path.dirname(path.dirname(listed.controlPath)))).toBe('home');
    expect(listed.controlPath.startsWith('/.e2e/') || listed.controlPath.includes('/.e2e/')).toBe(true);
  });
});
