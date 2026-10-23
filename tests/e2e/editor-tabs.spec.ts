import { expect, test } from '@playwright/test';
import { activeTab, gotoApp, openFixtureTree, tab, tabNames, treeRow } from './support/app';

test.describe('editor tabs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);
  });

  test('one click temp-opens; the next file click replaces the temp tab', async ({ page }) => {
    await treeRow(page, 'a.md').click();
    expect(await tabNames(page)).toEqual(['a.md']);
    await expect(tab(page, 'a.md')).toHaveClass(/\btemp\b/);

    await treeRow(page, 'b.csv').click();
    expect(await tabNames(page)).toEqual(['b.csv']);
    await expect(tab(page, 'b.csv')).toHaveClass(/\btemp\b/);
    await expect(tab(page, 'b.csv')).toHaveClass(/\bactive\b/);
  });

  test('double click pins the tab so the next click opens a second tab', async ({ page }) => {
    await treeRow(page, 'b.csv').click();
    await treeRow(page, 'b.csv').dblclick();
    await expect(tab(page, 'b.csv')).not.toHaveClass(/\btemp\b/);

    await treeRow(page, 'a.md').click();
    expect(await tabNames(page)).toEqual(['a.md', 'b.csv']);
    await expect(tab(page, 'b.csv')).not.toHaveClass(/\btemp\b/);
  });

  test('right-click on a tab shows Keep tab open, and it un-temps the tab', async ({ page }) => {
    await treeRow(page, 'a.md').click();
    await tab(page, 'a.md').click({ button: 'right' });

    const menu = page.locator('.menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Keep tab open/ })).toBeVisible();

    await menu.getByRole('menuitem', { name: /Keep tab open/ }).click();
    await expect(menu).toHaveCount(0);
    await expect(tab(page, 'a.md')).not.toHaveClass(/\btemp\b/);
  });

  test('close button removes the tab and activates its neighbour', async ({ page }) => {
    await treeRow(page, 'a.md').click();
    await treeRow(page, 'a.md').dblclick(); // pin a.md
    await treeRow(page, 'b.csv').click(); // temp b.csv
    expect(await tabNames(page)).toEqual(['b.csv', 'a.md']);

    await tab(page, 'b.csv').locator('button.close').click();

    expect(await tabNames(page)).toEqual(['a.md']);
    await expect(activeTab(page)).toContainText('a.md');
  });
});
