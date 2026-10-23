import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * The top-bar update button is driven entirely by GET /api/update. These tests
 * stub that endpoint so the UI states are covered without touching the real
 * checkout; the git behaviour itself is covered by tests/server/update.spec.ts.
 */

const status = (overrides: Record<string, unknown> = {}) => ({
  repo: '/srv/remotepad',
  branch: 'main',
  head: 'a'.repeat(40),
  remoteHead: 'b'.repeat(40),
  behind: 0,
  ahead: 0,
  dirty: false,
  canUpdate: false,
  checkedAt: new Date().toISOString(),
  ...overrides,
});

test.describe('update button', () => {
  test('shows the pending commit count and applies the update', async ({ page }) => {
    let applied = 0;
    await page.route('**/api/update', async (route) => {
      if (route.request().method() === 'POST') {
        applied += 1;
        await route.fulfill({ json: { ok: true, updated: false, message: 'Already up to date.' } });
        return;
      }
      await route.fulfill({ json: status({ behind: 2, canUpdate: true }) });
    });

    await gotoApp(page);
    const button = page.locator('.update-btn');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Update 2');
    await expect(button).toHaveClass(/ready/);

    await button.click();
    await expect(page.locator('.toast')).toHaveText('Already up to date.');
    expect(applied).toBe(1);
  });

  test('renders a disabled button when the checkout blocks the update', async ({ page }) => {
    await page.route('**/api/update', (route) =>
      route.fulfill({ json: status({ behind: 3, dirty: true, canUpdate: false }) }));

    await gotoApp(page);
    const button = page.locator('.update-btn');
    await expect(button).toHaveText('Update 3');
    await expect(button).toHaveClass(/blocked/);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /local changes/);
  });

  test('shows the running branch and hash when there is nothing to pull', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ json: status() }));

    await gotoApp(page);
    await expect(page.locator('.update-btn')).toHaveCount(0);
    const chip = page.locator('.version-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/^main@a{7}$/);
    await expect(chip).toHaveAttribute('title', /main @ a{40}/);
  });

  test('stays hidden when the endpoint fails', async ({ page }) => {
    await page.route('**/api/update', (route) => route.fulfill({ status: 500, json: { error: 'not a git repo' } }));

    await gotoApp(page);
    await expect(page.locator('.host-btn')).toBeVisible();
    await expect(page.locator('.update-btn')).toHaveCount(0);
  });
});
