import { expect, test } from '@playwright/test';
import { gotoApp, openFixtureTree, tab, treeRow } from './support/app';

/**
 * AGENTS.md gesture rule: every right-click menu item must show the hotkey or
 * gesture hint next to its label. These tests pin that contract for the menus a
 * user reaches from the tree and the tab strip.
 */
test.describe('right-click menus', () => {
  const menuRows = async (page: import('@playwright/test').Page) =>
    page.locator('.menu').getByRole('menuitem').evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [
        (el.querySelector('.menu-label')?.textContent || '').trim(),
        (el.querySelector('.menu-hint')?.textContent || '').trim(),
      ])),
    );

  test('file row menu keeps the double-click hints', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);

    await treeRow(page, 'a.md').click({ button: 'right' });
    await expect(page.locator('.menu')).toBeVisible();
    const items = await menuRows(page);

    expect(items['Keep tab open']).toBe('Dbl-click');
    expect(items['Download']).toBe('');
    expect(items['Rename']).toBeDefined();
  });

  test('folder row menu offers both explorer gestures with hints', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);

    await treeRow(page, 'sub').click({ button: 'right' });
    await expect(page.locator('.menu')).toBeVisible();
    const items = await menuRows(page);

    expect(items['Open in Explorer']).toBe('Dbl-click');
    expect(items['Open in new explorer']).toBeDefined();
    expect(items['Pin favorite']).toBeDefined();
  });

  test('clicking outside closes the menu without acting', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);

    await treeRow(page, 'a.md').click({ button: 'right' });
    await expect(page.locator('.menu')).toBeVisible();

    await page.mouse.click(5, 5);
    await expect(page.locator('.menu')).toHaveCount(0);
    await expect(tab(page, 'a.md')).toHaveCount(0);
  });

  test('tab menu offers Save with its hotkey hint', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);
    await treeRow(page, 'a.md').click();

    await tab(page, 'a.md').click({ button: 'right' });
    const save = page.locator('.menu').getByRole('menuitem', { name: /Save/ });
    await expect(save).toBeVisible();
    await expect(save.locator('.menu-hint')).toHaveText('Ctrl/⌘+S');
  });
});
