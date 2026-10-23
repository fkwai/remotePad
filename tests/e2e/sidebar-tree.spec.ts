import { expect, test } from '@playwright/test';
import { gotoApp, openFixtureTree, tabNames, treeRow } from './support/app';

test.describe('sidebar tree', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);
  });

  test('single click on a folder selects and expands it without opening Explorer', async ({ page }) => {
    const sub = treeRow(page, 'sub');
    await expect(treeRow(page, 'c.json')).toHaveCount(0);

    await sub.click();

    await expect(sub).toHaveClass(/\bactive\b/);
    await expect(sub.locator('.tree-twisty')).toHaveClass(/\bopen\b/);
    await expect(treeRow(page, 'c.json')).toBeVisible();
    // A single click must not open an Explorer tab.
    await expect(page.locator('.tabs .tab.folder')).toHaveCount(0);
  });

  test('clicking the chevron collapses the folder without opening Explorer', async ({ page }) => {
    const sub = treeRow(page, 'sub');
    await sub.click();
    await expect(treeRow(page, 'c.json')).toBeVisible();

    await treeRow(page, 'a.md').click();
    await expect(treeRow(page, 'a.md')).toHaveClass(/\bactive\b/);

    await sub.locator('.tree-twisty').click();
    await expect(sub.locator('.tree-twisty')).not.toHaveClass(/\bopen\b/);
    await expect(treeRow(page, 'c.json')).toHaveCount(0);
    // The chevron only toggles: it must not open an Explorer tab.
    await expect(page.locator('.tabs .tab.folder')).toHaveCount(0);
  });

  test('double click on a folder expands it and opens an Explorer tab', async ({ page }) => {
    await treeRow(page, 'sub').dblclick();

    await expect(page.locator('.tabs .tab.folder').filter({ hasText: 'sub' })).toBeVisible();
    await expect(page.locator('.folder-view')).toBeVisible();
    await expect(treeRow(page, 'c.json')).toBeVisible();
  });

  test('"..." row moves the tree root up one folder and keeps the branch expanded', async ({ page }) => {
    await page.locator('.tree-node.up').click();

    await expect(page.locator('.tree-node[data-depth="0"] .tree-name')).toHaveText('.e2e');
    await expect(treeRow(page, 'work')).toBeVisible();
    // goUp keeps the previous branch expanded instead of folding it.
    await expect(treeRow(page, 'a.md')).toBeVisible();
  });

  test('clicking a file row opens it in the editor', async ({ page }) => {
    await treeRow(page, 'a.md').click();

    expect(await tabNames(page)).toEqual(['a.md']);
    await expect(page.locator('.editor-body')).toContainText('Markdown body');
  });
});
