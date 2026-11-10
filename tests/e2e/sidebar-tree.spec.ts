import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureRoot, gotoApp, openFixtureTree, tabNames, treeRow } from './support/app';

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

  test('the frozen root row covers the top of the scroll box when scrolled', async ({ page }) => {
    // A tree deep enough to scroll, built here so the assertion does not depend
    // on how tall the fixture happens to be. The row has to be listed, so the
    // page is reloaded after the folder appears.
    const deep = path.join(fixtureRoot, 'deep');
    fs.mkdirSync(deep, { recursive: true });
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(deep, `f${i}.txt`), `${i}\n`);
    await page.reload();
    await openFixtureTree(page);

    await treeRow(page, 'deep').click();
    await expect(treeRow(page, 'f0.txt')).toBeVisible();

    const gap = await page.evaluate(() => {
      const body = document.querySelector('.tree-body:not(.side-list)') as HTMLElement;
      body.scrollTop = 120;
      const frozen = body.querySelector('.tree-node.sticky-root') as HTMLElement;
      const box = body.getBoundingClientRect();
      const row = frozen.getBoundingClientRect();
      return { scrolled: body.scrollTop, gap: Math.round(row.top - box.top), pad: getComputedStyle(body).paddingTop };
    });

    expect(gap.scrolled).toBeGreaterThan(0);
    // The frozen row has to meet the box edge; any gap is a strip where the rows
    // being scrolled past show through.
    expect(gap.pad).toBe('0px');
    expect(gap.gap).toBe(0);
  });

  // The user's complaint: "I expand many folders and every time I reopen
  // RemotePad the tree is fresh." Everything above proves the tree works within
  // one page load; this proves the expansion is still there after a reload.
  test('expanded folders and the selected row survive a reload', async ({ page }) => {
    await treeRow(page, 'sub').click();
    await expect(treeRow(page, 'c.json')).toBeVisible();

    // The save is a PUT fired off the state signature; wait for the profile to
    // hold the expansion so the reload reads what the app actually stored.
    await expect
      .poll(async () => {
        const stored = await (await page.request.get('/api/session')).json();
        return (stored.expanded as string[] | undefined)?.length ?? 0;
      }, { timeout: 8000 })
      .toBeGreaterThan(1);

    await page.reload();
    await expect(page.locator('.tree-node').first()).toBeVisible();

    await expect(treeRow(page, 'sub').locator('.tree-twisty')).toHaveClass(/\bopen\b/);
    await expect(treeRow(page, 'c.json')).toBeVisible();
    await expect(treeRow(page, 'sub')).toHaveClass(/\bactive\b/);
  });

  // A profile outlives the filesystem it describes: folders get renamed, deleted,
  // or become unreadable. Restoring one bad entry used to throw out of the whole
  // restore block, which reset the tree to `/` — the "always fresh" report.
  test('one missing folder does not throw away the restored tree', async ({ page }) => {
    await treeRow(page, 'sub').click();
    await expect(treeRow(page, 'c.json')).toBeVisible();

    // Take the profile the app itself just wrote, so the paths are the ones it
    // renders, then add an entry for a folder that is no longer there.
    const stored = await (await page.request.get('/api/session')).json();
    const expanded: string[] = stored.expanded;
    const gone = `${expanded[expanded.length - 1]}/gone`;
    await page.request.put('/api/session', { data: { ...stored, expanded: [...expanded, gone] } });

    await page.reload();
    await expect(page.locator('.tree-node').first()).toBeVisible();

    // The tree still points at the fixture, and the folder that does exist is open.
    await expect(treeRow(page, 'sub').locator('.tree-twisty')).toHaveClass(/\bopen\b/);
    await expect(treeRow(page, 'c.json')).toBeVisible();
    await expect(treeRow(page, 'a.md')).toBeVisible();
  });
});
