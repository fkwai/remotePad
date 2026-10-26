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

  test('lists every lane with its distance and offers a switch', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await page.route('**/api/channels', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ json: { ok: true, switched: false, message: 'Now on stable.' } });
      }
      return route.fulfill({ json: { channels: lanes } });
    });
    await gotoApp(page);
    await openPanel(page);

    const rows = page.locator('.version-channel');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('stable');
    await expect(rows.nth(0)).toContainText('3 behind');
    await expect(rows.nth(2)).toContainText('here');
    // The current lane has no switch button.
    await expect(rows.nth(2).locator('button')).toHaveCount(0);
    await expect(rows.nth(0).locator('button')).toHaveText('Switch');
  });

  test('a switch reports what it did', async ({ page }) => {
    let requested = '';
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await page.route('**/api/channels', (route) => {
      if (route.request().method() === 'POST') {
        requested = route.request().postData() || '';
        return route.fulfill({
          json: {
            ok: true,
            switched: false,
            message: 'Now on stable — restart RemotePad for server changes.',
          },
        });
      }
      return route.fulfill({ json: { channels: lanes } });
    });
    await gotoApp(page);
    await openPanel(page);

    await page.locator('.version-channel').nth(0).locator('button').click();

    await expect(page.locator('.version-note')).toContainText('Now on stable');
    expect(JSON.parse(requested)).toEqual({ channel: 'stable' });
  });

  test('a dirty tree disables switching instead of failing later', async ({ page }) => {
    await page.route('**/api/update', (route) =>
      route.fulfill({ json: status({ dirty: true }) }));
    await page.route('**/api/channels', (route) => route.fulfill({ json: { channels: lanes } }));
    await gotoApp(page);
    await openPanel(page);

    const button = page.locator('.version-channel').nth(0).locator('button');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /local changes/);
  });
});
