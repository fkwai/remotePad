import { expect, test } from '@playwright/test';
import { fixture, gotoApp } from './support/app';

/**
 * Reviewing the agent's edits: the tab must survive Keep all / Undo all — it used
 * to vanish and leave the editor empty.
 */
test.describe('agent review tabs', () => {
  const change = {
    path: fixture.markdown,
    kind: 'M',
    diff: '--- a\n+++ b\n@@\n-# Alpha\n+# Alpha edited\n',
    before: '# Alpha\n\nMarkdown body.\n',
    after: '# Alpha edited\n\nMarkdown body.\n',
  };

  test('Keep all leaves the file open instead of emptying the editor', async ({ page }) => {
    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === 'hello') {
          ws.send(JSON.stringify({
            type: 'ready', cwd: fixture.root, changes: [], sessions: [], history: [], backend: 'local',
          }));
          ws.send(JSON.stringify({ type: 'changes', files: [change], touched: [change.path] }));
        }
        if (msg.type === 'accept_all') {
          // Accepting clears the pending list; the tab must stay put.
          ws.send(JSON.stringify({ type: 'changes', files: [], touched: [change.path] }));
        }
      });
    });

    await gotoApp(page);
    await expect(page.locator('.agent-changes')).toContainText('1 file changed');

    await page.locator('.agent-change-main').first().click();
    const tab = page.locator('.tabs .tab').filter({ hasText: 'a.md' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveClass(/active/);

    await page.getByRole('button', { name: 'Keep all' }).click();

    await expect(page.locator('.agent-changes')).toHaveCount(0);
    await expect(tab).toBeVisible();
    // Still the active tab, so the editor pane is not blank.
    await expect(page.locator('.tabs .tab.active')).toHaveText(/a\.md/);
    await expect(page.locator('.empty', { hasText: 'Open a file from the tree' })).toHaveCount(0);
  });

  test('Undo all keeps the tab too', async ({ page }) => {
    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === 'hello') {
          ws.send(JSON.stringify({
            type: 'ready', cwd: fixture.root, changes: [], sessions: [], history: [], backend: 'local',
          }));
          ws.send(JSON.stringify({ type: 'changes', files: [change], touched: [change.path] }));
        }
        if (msg.type === 'undo_all') {
          ws.send(JSON.stringify({ type: 'changes', files: [], touched: [change.path] }));
        }
      });
    });

    await gotoApp(page);
    await page.locator('.agent-change-main').first().click();
    const tab = page.locator('.tabs .tab').filter({ hasText: 'a.md' });
    await expect(tab).toBeVisible();

    await page.getByRole('button', { name: 'Undo all' }).click();

    await expect(page.locator('.agent-changes')).toHaveCount(0);
    await expect(tab).toBeVisible();
  });
});
