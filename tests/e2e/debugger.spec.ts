import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoApp, openFixtureTree, treeRow } from './support/app';
import { work } from './support/prepare';

/**
 * The bottom region gains a Debug tab. Monaco is loaded from a CDN, so the
 * gutter and stack interaction is covered where it is deterministic: the node
 * debugger specs (real breakpoint → pause → step) and the code specs
 * (definition resolution). Here: the tab exists, opens the panel, and the
 * definition contract answers over HTTP.
 */

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || 3999}`;

test.describe('debugger panel', () => {
  test('the terminal bar offers Debug and the panel explains how to start', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);

    const tab = page.locator('.debug-tab');
    await expect(tab).toBeVisible();
    await tab.click();

    const panel = page.locator('.debug-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('No session');
    await expect(panel).toContainText('JavaScript/TypeScript');

    // Back to the shell: the terminal body is the visible one again.
    await tab.click();
    await expect(panel).toHaveCount(0);
  });

  test('definition lookup answers a file:line and refuses unsupported types', async ({ page, request }) => {
    await gotoApp(page);
    await openFixtureTree(page);
    const file = path.join(work, 'probe.py');
    fs.writeFileSync(file, 'def helper():\n    return 1\n\n\nvalue = helper()\n');

    const ok = await request.post(`${API}/api/code/definition`, {
      data: { path: file, line: 5, column: 10 },
    });
    expect(ok.ok()).toBe(true);
    const body = await ok.json() as { language: string; locations: { path: string; line: number }[] };
    expect(body.language).toBe('python');
    expect(body.locations[0]).toMatchObject({ path: file, line: 1 });

    const refused = await request.post(`${API}/api/code/definition`, {
      data: { path: path.join(work, 'a.md'), line: 1, column: 1 },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json() as { error: string }).error).toMatch(/supports/);
  });

});
