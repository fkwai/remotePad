import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * The version panel reports what this install runs and lets the reader change
 * lane.
 *
 * Two contracts live here. A row says what that lane is *right now* — its head,
 * its port, whether you are already on it. And pressing Switch loads that lane
 * **in this window**, keeping `?w=`: a lane is a server, the window is the
 * profile. Opening a second tab left the reader with two windows and the new one
 * on that lane's own default layout, which is not "switch to dev".
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

const channels = [
  { name: 'stable', branch: 'main', head: '1111111111111111111111111111111111111111', behind: 3, ahead: 0, current: false },
  { name: 'dev', branch: 'dev', head: '2222222222222222222222222222222222222222', behind: 1, ahead: 0, current: false },
  { name: 'nightly', branch: 'nightly', head: 'abcdef1234567890abcdef1234567890abcdef12', behind: 0, ahead: 0, current: true },
];

/** A running lane instance answers on its own port; stable is the install. */
const lanes = [
  { name: 'dev', branch: 'dev', alive: true, uiPort: 6200, apiPort: 6300 },
];

const mockPanel = async (page: import('@playwright/test').Page) => {
  // `*` after the path: the panel asks twice, the fast pass adds `?remote=0`.
  await page.route('**/api/update*', (route) => route.fulfill({ json: status() }));
  await page.route('**/api/channels', (route) => route.fulfill({ json: { channels } }));
  await page.route('**/api/lanes', (route) => route.fulfill({ json: { lanes } }));
  await page.route('**/api/previews', (route) => route.fulfill({ json: { previews: [] } }));
};

async function openPanel(page: import('@playwright/test').Page) {
  await page.locator('.topbar .brand').click();
  await expect(page.locator('.version-pop')).toBeVisible();
}

test.describe('version panel lanes', () => {
  test('names the lane this install runs, not the worktree branch', async ({ page }) => {
    await mockPanel(page);
    await gotoApp(page);

    await openPanel(page);
    await expect(page.locator('.version-title')).toContainText('v0.0.2-nightly.20261026');
    await expect(page.locator('.version-title .version-branch')).toHaveText('nightly@abcdef1');
  });

  test('each row reports its head, its port and whether you are on it', async ({ page }) => {
    await mockPanel(page);
    await gotoApp(page);
    await openPanel(page);

    const rows = page.locator('.version-channel');
    await expect(rows).toHaveCount(3);

    // stable is the install itself, three commits behind and not running beside it.
    await expect(rows.nth(0)).toContainText('stable');
    await expect(rows.nth(0).locator('.version-channel-meta')).toContainText('· install');
    await expect(rows.nth(0).locator('.version-channel-meta')).toContainText('3 behind');
    await expect(rows.nth(0).getByRole('button', { name: 'Switch' })).toBeDisabled();

    // dev runs on its own port, so it can be switched to.
    await expect(rows.nth(1).locator('.version-channel-meta')).toContainText(':6200');
    await expect(rows.nth(1).locator('.version-channel-meta')).toContainText('1 behind');
    await expect(rows.nth(1).getByRole('button', { name: 'Switch' })).toBeEnabled();
    await expect(rows.nth(1).getByRole('button', { name: 'Switch' }))
      .toHaveAttribute('title', /Switch this window to dev on :6200/);

    // The lane you are on says so, and has nowhere to switch to.
    await expect(rows.nth(2).locator('.version-channel-meta')).toContainText('· here');
    await expect(rows.nth(2).getByRole('button', { name: 'Switch' })).toBeDisabled();
  });

  test('Switch loads that lane in this window and keeps ?w=', async ({ page, context }) => {
    await mockPanel(page);
    // Stand in for the dev lane's own instance so the navigation can land.
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes(':6200')) {
        return route.fulfill({ contentType: 'text/html', body: '<h1>dev lane</h1>' });
      }
      return route.fallback();
    });

    await page.goto('/?w=alpha');
    await expect(page.locator('.app')).toBeVisible();
    await openPanel(page);

    await page.locator('.version-channel').nth(1).getByRole('button', { name: 'Switch' }).click();

    await expect(page.locator('h1')).toHaveText('dev lane');
    // Same window, other server: no new tab, and the profile id survives.
    expect(page.url()).toContain(':6200/?w=alpha');
  });

  test('Ctrl-click opens the lane in a new tab instead', async ({ page, context }) => {
    await mockPanel(page);
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes(':6200')) {
        return route.fulfill({ contentType: 'text/html', body: '<h1>dev lane</h1>' });
      }
      return route.fallback();
    });

    await gotoApp(page);
    await openPanel(page);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('.version-channel').nth(1)
        .getByRole('button', { name: 'Switch' })
        .click({ modifiers: ['Control'] }),
    ]);
    expect(popup.url()).toContain(':6200');
    // This window stays where it was.
    await expect(page.locator('.version-pop')).toBeVisible();
    await popup.close();
  });
});
