import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * The version panel tells you what you are running and lets you change lane.
 *
 * The bug this guards: on a preview branch the badge said `helper/nightly` and the
 * panel warned "no remote ref" even though the branch tracked `origin/nightly`
 * correctly, and there was no way to move to another lane without git.
 */
const status = (overrides: Record<string, unknown> = {}) => ({
  repo: '/srv/remotepad',
  version: '0.0.2-nightly.20261026',
  branch: 'nightly',
  channel: 'nightly',
  upstream: 'origin/nightly',
  head: 'abcdef1234567890abcdef1234567890abcdef12',
  remoteHead: 'abcdef1234567890abcdef1234567890abcdef12',
  behind: 0,
  ahead: 0,
  dirty: false,
  canUpdate: false,
  checkedAt: new Date().toISOString(),
  ...overrides,
});

const lanes = [
  { name: 'stable', branch: 'main', head: '1111111111111111111111111111111111111111', behind: 3, ahead: 0, current: false },
  { name: 'dev', branch: 'dev', head: '2222222222222222222222222222222222222222', behind: 1, ahead: 0, current: false },
  { name: 'nightly', branch: 'nightly', head: 'abcdef1234567890abcdef1234567890abcdef12', behind: 0, ahead: 0, current: true },
];

async function openPanel(page: import('@playwright/test').Page) {
  await page.locator('.topbar .brand').click();
  await expect(page.locator('.version-pop')).toBeVisible();
}

/** A running lane instance is a preview named after the lane. */
const previews = (names: string[]) => ({
  previews: names.map((name, i) => ({
    name,
    uiPort: 6200 + i,
    apiPort: 6300 + i,
    alive: true,
  })),
});

test.describe('version panel lanes', () => {
  test('shows the lane name and the upstream it tracks', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await page.route('**/api/channels', (route) => route.fulfill({ json: { channels: lanes } }));
    await gotoApp(page);

    // Badge: lane, not the worktree branch name.
    await expect(page.locator('.topbar .version-badge')).toHaveText(/^nightly@abcdef1$/);
    await expect(page.locator('.topbar .version-badge')).toHaveAttribute('title', /tracks origin\/nightly/);

    await openPanel(page);
    await expect(page.locator('.version-title')).toContainText('v0.0.2-nightly.20261026');
    await expect(page.locator('.version-rows')).toContainText('nightly → origin/nightly');
    // No false warning about a missing remote ref.
    await expect(page.locator('.version-warn')).toHaveCount(0);
  });

  test('lists every lane, opening the ones that run on their own port', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await page.route('**/api/channels', (route) => route.fulfill({ json: { channels: lanes } }));
    // stable is here; dev runs; nightly does not.
    await page.route('**/api/previews', (route) => route.fulfill({ json: previews(['dev']) }));
    await gotoApp(page);
    await openPanel(page);

    const rows = page.locator('.version-channel');
    await expect(rows).toHaveCount(3);

    await expect(rows.nth(0)).toContainText('stable');
    await expect(rows.nth(0)).toContainText('3 behind');
    // No in-place switching anywhere: a lane is a port, not a checkout rewrite.
    await expect(page.getByRole('button', { name: 'Switch' })).toHaveCount(0);

    await expect(rows.nth(1)).toContainText(':6200');
    await expect(rows.nth(1).locator('button')).toHaveText('Open');
    await expect(rows.nth(1).locator('button')).toHaveAttribute('title', /port 6200/);

    await expect(rows.nth(2)).toContainText('here');
    await expect(rows.nth(2).locator('button')).toHaveCount(0);

    // A lane with no instance offers the command instead of a broken link.
    await expect(rows.nth(0).locator('button')).toHaveText('Start');
    await expect(rows.nth(0).locator('button')).toHaveAttribute('title', /lanes\.sh start stable/);
  });

  test('Open points at that lane’s port and says how to reach it', async ({ page, context }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await page.route('**/api/channels', (route) => route.fulfill({ json: { channels: lanes } }));
    await page.route('**/api/previews', (route) => route.fulfill({ json: previews(['dev']) }));
    // Stand in for the dev lane's own instance so the popup can actually load.
    await context.route('**/*', async (route) => {
      if (route.request().url().includes(':6200')) {
        return route.fulfill({ contentType: 'text/html', body: '<h1>dev lane</h1>' });
      }
      return route.fallback();
    });
    await gotoApp(page);
    await openPanel(page);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('.version-channel').nth(1).locator('button').click(),
    ]);
    await expect(popup.locator('h1')).toHaveText('dev lane');
    expect(popup.url()).toContain(':6200');
    await popup.close();

    await expect(page.locator('.version-note')).toContainText('6200');
    await expect(page.locator('.version-note')).toContainText('ssh -N -L 6200:127.0.0.1:6200');
  });
});
