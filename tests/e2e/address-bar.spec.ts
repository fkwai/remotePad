import { expect, test } from '@playwright/test';
import { fixture, fixtureRoot, goToPath, gotoApp, tabNames } from './support/app';

test.describe('address bar', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test('Enter on a folder opens an Explorer tab and updates the address', async ({ page }) => {
    await goToPath(page, fixtureRoot + '/sub');

    await expect(page.locator('.tabs .tab.folder')).toContainText('sub');
    await expect(page.locator('.folder-view')).toBeVisible();
    await expect(page.locator('input.path-input')).toHaveValue(fixtureRoot + '/sub');
  });

  test('Enter on a file opens it in the editor', async ({ page }) => {
    await goToPath(page, fixture.markdown);

    expect(await tabNames(page)).toEqual(['a.md']);
    await expect(page.locator('.editor-body')).toContainText('Alpha');
    await expect(page.locator('input.path-input')).toHaveValue(fixture.markdown);
  });

  test('a missing path reports "Path not found" and leaves tabs alone', async ({ page }) => {
    await goToPath(page, fixtureRoot + '/does-not-exist.md');

    await expect(page.locator('.toast')).toHaveText('Path not found');
    expect(await tabNames(page)).toEqual([]);
  });

  test('Escape restores the current path and drops focus', async ({ page }) => {
    const input = page.locator('input.path-input');
    await input.click();
    await input.fill('/definitely/not/here');
    await input.press('Escape');

    await expect(input).toHaveValue('/');
    await expect(input).not.toBeFocused();
  });
});
