import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fixture, fixtureRoot } from './support/app';

/**
 * Two windows, two workspaces.
 *
 * `?w=<id>` gives a tab its own layout and its own Agent conversation. The
 * assertions are the user's: window A keeps its own files when window B is open,
 * and reloading A brings its layout back.
 */
const rootName = path.basename(fixtureRoot);

const open = async (page: import('@playwright/test').Page, id: string) => {
  await page.goto(id === 'default' ? '/' : `/?w=${id}`);
  await expect(page.locator('.topbar .brand')).toBeVisible();
  await expect(page.locator('.tree-node').first()).toBeVisible();
};

test.describe('multiple windows', () => {
  test('each window restores its own layout', async ({ page, context }) => {
    const save = page.waitForResponse((res) =>
      res.url().includes('/api/session') && res.request().method() === 'PUT');

    await open(page, 'alpha');
    // A window with a file open in its own repo.
    await page.locator('input.path-input').click();
    await page.locator('input.path-input').fill(fixtureRoot);
    await page.locator('input.path-input').press('Enter');
    await expect(page.locator('.tabs .tab').filter({ hasText: rootName })).toBeVisible();
    await save;

    // A second window starts empty instead of inheriting the first one's tabs.
    const other = await context.newPage();
    await open(other, 'beta');
    await expect(other.locator('.tabs .tab')).toHaveCount(0);
    await other.close();

    // Reloading the first window restores exactly its own state.
    await page.reload();
    await expect(page.locator('.tabs .tab').filter({ hasText: rootName })).toBeVisible();
  });

  test('the API keeps a window’s state apart', async ({ page }) => {
    await open(page, 'gamma');

    const shape = (treeRoot: string) => ({
      repoPath: null, treeRoot, selected: treeRoot, expanded: [treeRoot],
      tabs: [{ path: `${treeRoot}/a.md`, viewMode: 'rendered', folder: false }],
      activePath: `${treeRoot}/a.md`, sideTab: 'favorites', termOpen: true, rightTab: 'agent',
    });

    await page.request.put('/api/session?w=gamma', { data: shape('/srv/gamma') });
    await page.request.put('/api/session?w=delta', { data: shape('/srv/delta') });

    const gamma = await (await page.request.get('/api/session?w=gamma')).json();
    const delta = await (await page.request.get('/api/session?w=delta')).json();
    const plain = await (await page.request.get('/api/session')).json();

    expect(gamma.treeRoot).toBe('/srv/gamma');
    expect(delta.treeRoot).toBe('/srv/delta');
    // An ordinary link (no ?w=) is still its own state, not one of the windows.
    expect(plain.treeRoot).not.toBe('/srv/gamma');
  });

  test('right-clicking the wordmark opens a new window', async ({ page, context }) => {
    await open(page, 'epsilon');

    await page.locator('.topbar .brand').click({ button: 'right' });
    const menu = page.locator('.menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Open new window/ })).toBeVisible();

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      menu.getByRole('menuitem', { name: /Open new window/ }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');

    const id = new URL(popup.url()).searchParams.get('w');
    expect(id).toBeTruthy();
    expect(id).not.toBe('epsilon');
    await popup.close();
  });

  test('copying the window link keeps the id', async ({ page }) => {
    await open(page, 'zeta');
    await page.locator('.topbar .brand').click({ button: 'right' });
    await page.locator('.menu').getByRole('menuitem', { name: /Copy link/ }).click();
    await expect(page.locator('.toast')).toContainText('/?w=zeta');
  });

  test('fixtures are reachable in the second window too', async ({ page }) => {
    // Sanity: a window is a view, not a separate filesystem.
    await open(page, 'eta');
    await page.locator('.fav-item').filter({ hasText: 'fixture' }).first().click();
    await expect(page.locator('.tree-node').filter({ hasText: 'a.md' })).toBeVisible();
    expect(fixture.markdown).toContain('a.md');
  });
});

test.describe('agent per window', () => {
  test('switching the Agent backend in one window leaves the other alone', async ({ page, context }) => {
    await open(page, 'theta');
    const other = await context.newPage();
    await open(other, 'iota');

    // What the default window looked like before any switching.
    const before = await (await page.request.get('/api/agent/state')).json();

    // Window one switches to the local runtime…
    await page.getByRole('button', { name: 'Local', exact: true }).click();
    await expect
      .poll(async () => {
        const state = await (await page.request.get('/api/agent/state?w=theta')).json();
        return state.backend;
      }, { timeout: 15_000 })
      .toBe('local');

    // …window two is still on the cloud backend.
    const second = await (await other.request.get('/api/agent/state?w=iota')).json();
    expect(second.backend).toBe('catsco');

    // And the default window (no ?w=) was not dragged along either.
    const plain = await (await page.request.get('/api/agent/state')).json();
    expect(plain.backend).toBe(before.backend);

    await other.close();
  });
});

/**
 * A saved layout can be unopenable: a tab on a file too big for the editor froze
 * the window, and because the layout is saved, every reload came back the same
 * way. `default` is the plain link, so it was the one window with no way out.
 */
test.describe('forgetting a layout', () => {
  const shape = (treeRoot: string, file: string) => ({
    repoPath: null,
    treeRoot,
    selected: file,
    expanded: [treeRoot],
    tabs: [{ path: file, viewMode: 'rendered', folder: false }],
    activePath: file,
    sideTab: 'favorites',
    termOpen: true,
    rightTab: 'agent',
  });

  test('the default window can be forgotten like a named one', async ({ page }) => {
    await page.request.put('/api/session', { data: shape(fixtureRoot, fixture.markdown) });

    await page.goto('/');
    await expect(page.locator('.tabs .tab').filter({ hasText: 'a.md' })).toHaveCount(1);

    await page.locator('.topbar .brand').click();
    const row = page.locator('.version-window').filter({ hasText: 'default' });
    await expect(row).toHaveCount(1);
    await row.locator('.version-window-del').click();

    // Forgetting the window you are sitting in reaches the page itself.
    await expect(page.locator('.tabs .tab')).toHaveCount(0);
    await expect(page.locator('input.path-input')).toHaveValue('/');

    const saved = await (await page.request.get('/api/session')).json();
    expect(saved.tabs).toEqual([]);
  });

  test('?reset=1 starts blank instead of restoring the layout', async ({ page }) => {
    await page.request.put('/api/session', { data: shape(fixtureRoot, fixture.markdown) });

    await page.goto('/?reset=1');
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.tabs .tab')).toHaveCount(0);
    // The flag is spent, so a reload keeps whatever the reader does next.
    await expect(page).toHaveURL(/\/$/);
  });
});
