import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * Clicking the RemotePad wordmark reports what this install is running. It used
 * to open a gesture manual instead; the manual is gone.
 */
test.describe('version panel', () => {
  const status = (overrides: Record<string, unknown> = {}) => ({
    repo: '/srv/remotepad',
    version: '0.0.1',
    branch: 'main',
    head: 'abcdef1234567890abcdef1234567890abcdef12',
    remoteHead: 'abcdef1234567890abcdef1234567890abcdef12',
    behind: 0,
    ahead: 0,
    dirty: false,
    canUpdate: false,
    checkedAt: new Date().toISOString(),
    ...overrides,
  });

  test('the wordmark opens version, commit and origin state', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await gotoApp(page);

    await page.locator('.topbar .brand').click();
    const pop = page.locator('.version-pop');
    await expect(pop).toBeVisible();

    await expect(pop.locator('.version-title')).toContainText('v0.0.1');
    await expect(pop.locator('.version-title')).toContainText('main@abcdef1');
    await expect(pop).toContainText('/srv/remotepad');
    await expect(pop).toContainText('up to date');
    await expect(pop).toContainText('clean');
  });

  test('reports pending pulls and a dirty tree', async ({ page }) => {
    await page.route('**/api/update', (route) =>
      route.fulfill({ json: status({ behind: 3, ahead: 1, dirty: true, canUpdate: false }) }));
    await gotoApp(page);

    await page.locator('.topbar .brand').click();
    const pop = page.locator('.version-pop');
    await expect(pop).toContainText('3 to pull · 1 unpushed');
    await expect(pop).toContainText('local changes');
  });

  test('no gesture manual is attached to the wordmark any more', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await gotoApp(page);

    await page.locator('.topbar .brand').click();
    await expect(page.locator('.version-pop')).toBeVisible();
    await expect(page.locator('.help-pop')).toHaveCount(0);
    await expect(page.getByText('How to use')).toHaveCount(0);
  });

  test('closes from its own close button', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));
    await gotoApp(page);

    await page.locator('.topbar .brand').click();
    await page.locator('.version-pop .float-pop-head button').click();
    await expect(page.locator('.version-pop')).toHaveCount(0);
  });
});

test.describe('version panel previews', () => {
  const status = {
    repo: '/srv/remotepad', version: '0.0.1', branch: 'main',
    head: 'abcdef1234567890abcdef1234567890abcdef12',
    remoteHead: 'abcdef1234567890abcdef1234567890abcdef12',
    behind: 0, ahead: 0, dirty: false, canUpdate: false,
    checkedAt: new Date().toISOString(),
  };

  test('lists running previews with the port to forward', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status }));
    await page.route('**/api/previews', (route) => route.fulfill({
      json: {
        previews: [
          { name: 'keepall-stop-preview', uiPort: 6128, apiPort: 6129, alive: true },
          { name: 'old-feature', uiPort: 6104, alive: false },
        ],
      },
    }));

    await gotoApp(page);
    await page.locator('.topbar .brand').click();

    const live = page.locator('.version-preview.live');
    await expect(live).toContainText('keepall-stop-preview');
    await expect(live).toContainText(':6128');
    await expect(live.locator('button')).toHaveAttribute(
      'title', /ssh -N -L 6128:127\.0\.0\.1:6128/,
    );
    await expect(page.locator('.version-preview.dead')).toContainText(':6104');
  });

  test('says none are running when there are none', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status }));
    await page.route('**/api/previews', (route) => route.fulfill({ json: { previews: [] } }));

    await gotoApp(page);
    await page.locator('.topbar .brand').click();
    await expect(page.locator('.version-previews')).toContainText('None running');
  });
});
