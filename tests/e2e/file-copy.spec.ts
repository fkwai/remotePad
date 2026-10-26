import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fixtureRoot, goToPath, gotoApp, openFixtureTree, treeRow } from './support/app';

/**
 * Copy / paste of files, the way the user does it.
 *
 * Copying leaves the original alone and lands `x copy.ext` next to it; cutting
 * moves. Both are reachable from the right-click menus (with their hotkey hints)
 * and from the keyboard, in the Sidebar tree and in an Explorer.
 */
const work = fixtureRoot;
const copyOf = (name: string) => path.join(work, name);

/**
 * A menu row, matched by its label only.
 *
 * The accessible name of a row is label + hint ("Copy Ctrl/⌘+C"), which is why
 * matching on the accessible name was flaky here.
 */
const menuItem = (page: import('@playwright/test').Page, label: string) =>
  page
    .locator('.menu [role="menuitem"]')
    .filter({ has: page.locator('.menu-label', { hasText: new RegExp(`^${label}$`) }) });

test.describe('file copy in the explorer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await goToPath(page, work);
    await expect(page.locator('.folder-view')).toBeVisible();
  });

  test('right-click Copy then Paste here duplicates the file', async ({ page }) => {
    const original = fs.readFileSync(copyOf('a.md'), 'utf8');

    await page.locator('.folder-tile', { hasText: 'a.md' }).first().click({ button: 'right' });
    const menu = page.locator('.menu');
    await expect(menuItem(page, 'Copy')).toBeVisible();
    await menuItem(page, 'Copy').click();

    // Paste is only offered once something is on the clipboard.
    await expect(menu).toHaveCount(0);
    await page.locator('.folder-view').click({ button: 'right', position: { x: 20, y: 300 } });
    await menuItem(page, 'Paste here').click();

    await expect(page.locator('.folder-tile', { hasText: 'a copy.md' })).toBeVisible();
    expect(fs.readFileSync(copyOf('a copy.md'), 'utf8')).toBe(original);
    expect(fs.readFileSync(copyOf('a.md'), 'utf8')).toBe(original);
  });

  test('keyboard Ctrl+C / Ctrl+V does the same', async ({ page }) => {
    await page.locator('.folder-tile', { hasText: 'b.csv' }).first().click();
    await page.keyboard.press('Control+c');
    await expect(page.locator('.toast')).toContainText('copied');

    await page.keyboard.press('Control+v');
    await expect(page.locator('.folder-tile', { hasText: 'b copy.csv' })).toBeVisible();
    expect(fs.existsSync(copyOf('b copy.csv'))).toBe(true);
  });

  test('cut moves the file and clears the clipboard', async ({ page }) => {
    // A file that exists only for this test keeps the fixture reusable.
    fs.writeFileSync(copyOf('movable.txt'), 'move me\n');

    await page.locator('.folder-tile', { hasText: 'movable.txt' }).first().click();
    await page.keyboard.press('Control+x');
    await expect(page.locator('.toast')).toContainText('cut');

    await page.locator('.folder-tile', { hasText: 'sub' }).first().click({ button: 'right' });
    await menuItem(page, 'Paste here').click();

    await expect(page.locator('.folder-tile', { hasText: 'movable.txt' })).toHaveCount(0);
    expect(fs.existsSync(copyOf('sub/movable.txt'))).toBe(true);
    expect(fs.existsSync(copyOf('movable.txt'))).toBe(false);
  });

  test('the menu shows the hotkeys it obeys', async ({ page }) => {
    await page.locator('.folder-tile', { hasText: 'a.md' }).first().click({ button: 'right' });
    const rows = await page.locator('.menu').getByRole('menuitem').evaluateAll((els) =>
      els.map((el) => [
        (el.querySelector('.menu-label')?.textContent || '').trim(),
        (el.querySelector('.menu-hint')?.textContent || '').trim(),
      ]));
    const hints = Object.fromEntries(rows);
    expect(hints.Copy).toBe('Ctrl/⌘+C');
    expect(hints.Cut).toBe('Ctrl/⌘+X');
  });
});

test.describe('file copy in the sidebar tree', () => {
  test('copy a file into a sibling folder', async ({ page }) => {
    // A folder of its own keeps the shared fixtures untouched for other specs.
    const folder = 'tree-target';
    const target = copyOf(`${folder}/a.md`);
    fs.mkdirSync(copyOf(folder), { recursive: true });

    try {
      await gotoApp(page);
      await openFixtureTree(page);

      await treeRow(page, 'a.md').click({ button: 'right' });
      await menuItem(page, 'Copy').click();

      await treeRow(page, folder).click({ button: 'right' });
      await menuItem(page, 'Paste here').click();

      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe(fs.readFileSync(copyOf('a.md'), 'utf8'));
      expect(fs.existsSync(copyOf('a.md'))).toBe(true);
    } finally {
      fs.rmSync(copyOf(folder), { recursive: true, force: true });
    }
  });

  test('pasting a folder into itself is not offered', async ({ page }) => {
    await gotoApp(page);
    await openFixtureTree(page);

    await treeRow(page, 'sub').click({ button: 'right' });
    await menuItem(page, 'Copy').click();

    await treeRow(page, 'sub').click({ button: 'right' });
    await expect(menuItem(page, 'Paste here')).toHaveCount(0);
  });
});
