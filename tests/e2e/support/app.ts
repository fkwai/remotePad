import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.e2e', 'state.json'), 'utf8'));

export const fixture = state.fixture as {
  root: string;
  markdown: string;
  csv: string;
  nestedJson: string;
};
export const fixtureRoot: string = state.work;

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Load the app with a known UI restore state.
 *
 * The server persists UI state (tmp/session.json) between page loads, so a
 * previous test could otherwise decide which tab, tree root or terminal state
 * this test starts from. An empty body means "cold start": the app must open
 * with the terminal region visible, matching README/AGENTS.
 */
export async function gotoApp(page: Page, uiState: { termOpen?: boolean } = {}) {
  await page.request.put('/api/session', { data: { ...uiState } });
  const hydrated = page.waitForResponse(
    (res) => res.url().includes('/api/session') && res.request().method() === 'GET',
  );
  await page.goto('/');
  await hydrated.catch(() => undefined);
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.host-btn')).toBeVisible();
  await expect(page.locator('.tree-node').first()).toBeVisible();
}

/** Pin the fixture folder as the tree root through the seeded favorite row. */
export async function openFixtureTree(page: Page) {
  await page.locator('.fav-item').filter({ hasText: 'fixture' }).first().click();
  await expect(treeRow(page, 'a.md')).toBeVisible();
}

/** One sidebar tree row, matched on the exact file/folder label. */
export function treeRow(page: Page, name: string): Locator {
  return page
    .locator('.tree-node')
    .filter({ has: page.locator('.tree-name', { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
}

/** One editor tab, matched on its label (the tab also contains a close button). */
export function tab(page: Page, name: string): Locator {
  return page.locator('.tabs .tab').filter({ hasText: new RegExp(`^${escapeRe(name)}`) });
}

export async function tabNames(page: Page): Promise<string[]> {
  return page.$$eval('.tabs .tab', (els) => els.map((el) => (el.firstElementChild?.textContent || '').trim()));
}

/** Open a path through the address bar, the way a user would. */
export async function goToPath(page: Page, target: string) {
  const input = page.locator('input.path-input');
  await input.click();
  await input.fill(target);
  await input.press('Enter');
}

export function activeTab(page: Page): Locator {
  return page.locator('.tabs .tab.active');
}
