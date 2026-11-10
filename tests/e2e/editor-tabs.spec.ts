import { expect, test } from '@playwright/test';
import { activeTab, gotoApp, openFixtureTree, tab, tabNames, treeRow } from './support/app';

test.describe('editor tabs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);
  });

  // The editor engine used to come from a CDN: offline it stayed on "Loading…", the
  // version was whatever the CDN felt like serving, and no test could assert on the
  // editor itself. With the CDN unreachable the editor still has to work.
  test('the editor engine is served by this app, not a CDN', async ({ page }) => {
    const cdn: string[] = [];
    await page.route('**cdn.jsdelivr.net/**', (route) => {
      cdn.push(route.request().url());
      return route.abort();
    });
    await page.reload();
    await openFixtureTree(page);

    await treeRow(page, 'sub').click();
    await treeRow(page, 'sample.ts').click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('answer');
    expect(cdn).toEqual([]);
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

  // "Keep tab open" used to clear a flag on the tab buffer while the pane kept
  // rendering `temp` from its own entry, so the tab looked kept for one frame and
  // was replaced by the next click anyway.
  test('a tab kept from its own menu is not replaced by the next click', async ({ page }) => {
    await treeRow(page, 'a.md').click();
    await tab(page, 'a.md').click({ button: 'right' });
    await page.locator('.menu').getByRole('menuitem', { name: /Keep tab open/ }).click();
    await expect(tab(page, 'a.md')).not.toHaveClass(/\btemp\b/);

    await treeRow(page, 'b.csv').click();
    expect(await tabNames(page)).toEqual(['b.csv', 'a.md']);
  });

  // Saving is a decision about the file, so a preview tab that gets saved stays
  // open — including when the save changed nothing.
  test('Ctrl+S keeps a preview tab open, even with no edit', async ({ page }) => {
    await treeRow(page, 'a.md').click();
    await expect(tab(page, 'a.md')).toHaveClass(/\btemp\b/);

    await page.keyboard.press('Control+s');
    await expect(tab(page, 'a.md')).not.toHaveClass(/\btemp\b/);

    await treeRow(page, 'b.csv').click();
    expect(await tabNames(page)).toEqual(['b.csv', 'a.md']);
  });

  test('close button removes the tab and activates its neighbour', async ({ page }) => {    await treeRow(page, 'a.md').click();
    await treeRow(page, 'a.md').dblclick(); // pin a.md
    await treeRow(page, 'b.csv').click(); // temp b.csv
    expect(await tabNames(page)).toEqual(['b.csv', 'a.md']);

    await tab(page, 'b.csv').locator('button.close').click();

    expect(await tabNames(page)).toEqual(['a.md']);
    await expect(activeTab(page)).toContainText('a.md');
  });
});
