import { expect, test } from '@playwright/test';
import { gotoApp } from './support/app';

/**
 * Stop must disappear the moment the turn ends. Regression: the cloud's
 * `task_status` can lag behind the reply, and the panel trusted it, so Stop
 * stayed on after CatsCo had answered.
 */
test.describe('agent stop button', () => {
  const ready = {
    type: 'ready', cwd: '/', changes: [], sessions: [], history: [], backend: 'catsco',
  };
  const list = (working: boolean) => ({
    type: 'catsco_list',
    bots: [{ uid: 'b1', name: 'CatsCo', isCurrent: true }],
    projects: [],
    conversations: [{
      id: 't1', title: 'task', preview: '', isGroup: false, isTask: true, working,
    }],
    topicId: 't1',
    ready: true,
  });

  test('stops showing Stop once the cloud turn settles', async ({ page }) => {
    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type !== 'hello') return;
        ws.send(JSON.stringify(ready));
        ws.send(JSON.stringify(list(true)));
        ws.send(JSON.stringify({ type: 'user', text: 'run it' }));
        ws.send(JSON.stringify({ type: 'status', state: 'running' }));
        // The reply lands, then the list is corrected by the settle step.
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'text', text: 'done\n' }));
          ws.send(JSON.stringify({ type: 'status', state: 'idle', message: 'session-file' }));
          ws.send(JSON.stringify(list(false)));
        }, 300);
      });
    });

    await gotoApp(page);
    const stop = page.locator('.agent-compose-row button.danger');
    const send = page.locator('.agent-compose-row button.primary');

    await expect(page.locator('.agent-msg.assistant')).toContainText('done');
    await expect(stop).toHaveCount(0);
    await expect(send).toBeVisible();
  });

  test('a corrected list alone releases Stop', async ({ page }) => {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });

    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type !== 'hello') return;
        ws.send(JSON.stringify(ready));
        ws.send(JSON.stringify(list(true)));
        void released.then(() => ws.send(JSON.stringify(list(false))));
      });
    });

    await gotoApp(page);
    const stop = page.locator('.agent-compose-row button.danger');
    await expect(stop).toBeVisible();

    release();

    await expect(stop).toHaveCount(0);
    await expect(page.locator('.agent-compose-row button.primary')).toBeVisible();
  });
});
