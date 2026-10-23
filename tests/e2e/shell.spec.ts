import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

test.describe('shell', () => {
  test('loads the sidebar, editor and terminal regions', async ({ page }) => {
    await gotoApp(page);

    await expect(page.locator('.topbar .brand')).toContainText('RemotePad');
    await expect(page.locator('input.path-input')).toBeVisible();
    // `.tree-body` is also used by the Favorites/Repos list; the tree is the one without side-list.
    await expect(page.locator('.tree-body:not(.side-list)')).toBeVisible();
    await expect(page.locator('.tabs-bar')).toBeVisible();
    // Cold start (empty restore state) opens the terminal region, per README/AGENTS.
    await expect(page.locator('.term-toggle')).toHaveClass(/\bon\b/);
    await expect(page.locator('.term-bar')).toBeVisible();
  });

  test('an explicitly closed terminal stays closed after reload', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.term-toggle').click();
    await expect(page.locator('.term-toggle')).not.toHaveClass(/\bon\b/);

    // Reload without resetting: the saved layout must win over the default.
    await page.reload();
    await expect(page.locator('.host-btn')).toBeVisible();
    await expect(page.locator('.term-toggle')).not.toHaveClass(/\bon\b/);
  });

  test('Terminal button hides and reopens the terminal region', async ({ page }) => {
    await gotoApp(page, { termOpen: true });
    const toggle = page.locator('.term-toggle');
    await expect(toggle).toHaveClass(/\bon\b/);
    await expect(page.locator('.term-bar')).toBeVisible();

    await toggle.click();
    await expect(toggle).not.toHaveClass(/\bon\b/);
    await expect(page.locator('.term-bar')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveClass(/\bon\b/);
    await expect(page.locator('.term-bar')).toBeVisible();
  });

  test('"+ Terminal" starts a live pty session that runs a command', async ({ page }) => {
    await gotoApp(page, { termOpen: true });
    await page.getByRole('button', { name: '+ Terminal' }).click();

    await expect(page.locator('.term-tab')).toHaveCount(1);
    await expect(page.locator('.xterm')).toBeVisible();

    await page.locator('.term-body').click();
    await page.keyboard.type('echo e2e-pty-$((6*7))\n');
    // Round trip through node-pty: the shell must echo both the command and its output.
    await expect(page.locator('.xterm')).toContainText('e2e-pty-42', { timeout: 15_000 });
  });
});
