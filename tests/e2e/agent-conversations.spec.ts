import { expect, test } from '@playwright/test';
import { fixture, gotoApp } from './support/app';

/**
 * Two conversations in one panel must not share state.
 *
 * Reported from real use: the draft typed into the Agent box followed you into
 * another conversation, and a file review opened in one chat stayed open in the
 * next. The server is stubbed at the socket; the assertions are what the user
 * sees.
 */
const change = {
  path: fixture.markdown,
  kind: 'M',
  diff: '--- a\n+++ b\n@@\n-# Alpha\n+# Alpha edited\n',
  before: '# Alpha\n\nMarkdown body.\n',
  after: '# Alpha edited\n\nMarkdown body.\n',
};

const list = (topicId: string) => ({
  type: 'catsco_list',
  bots: [{ uid: 'b1', name: 'CatsCo', isCurrent: true }],
  projects: [],
  conversations: [
    { id: 'grp_a', title: 'first chat', preview: '', isGroup: true, isTask: true, working: false },
    { id: 'grp_b', title: 'second chat', preview: '', isGroup: true, isTask: true, working: false },
  ],
  topicId,
  ready: true,
});

const ready = (topic: string, changes: unknown[] = []) => ({
  type: 'ready',
  cwd: fixture.root,
  changes,
  sessions: [],
  history: [],
  backend: 'catsco',
  sessionKey: `catsco:${topic}`,
});

type Stub = { send: (data: string) => void };

async function openWithStub(page: import('@playwright/test').Page, topic: string) {
  const box: { sock?: Stub } = {};
  await page.routeWebSocket('**/ws/agent', (ws) => {
    box.sock = ws as unknown as Stub;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string };
      if (msg.type !== 'hello') return;
      ws.send(JSON.stringify(ready(topic)));
      ws.send(JSON.stringify(list(topic)));
    });
  });
  await gotoApp(page);
  return box;
}

test.describe('agent conversations', () => {
  test('a draft stays in the conversation it was typed in', async ({ page }) => {
    const stub = await openWithStub(page, 'grp_a');
    const compose = page.locator('.agent-compose-editor');

    await compose.click();
    await page.keyboard.type('half-written question');
    await expect(compose).toContainText('half-written question');

    // Switch conversation the way the server does it: new list, new ready.
    stub.sock!.send(JSON.stringify(list('grp_b')));
    stub.sock!.send(JSON.stringify(ready('grp_b')));
    await expect(compose).toHaveText('');

    // Coming back returns the draft instead of losing it.
    stub.sock!.send(JSON.stringify(list('grp_a')));
    stub.sock!.send(JSON.stringify(ready('grp_a')));
    await expect(compose).toContainText('half-written question');
  });

  test('a file review does not follow you into another conversation', async ({ page }) => {
    const stub = await openWithStub(page, 'grp_a');
    stub.sock!.send(JSON.stringify({
      type: 'changes', files: [change], touched: [change.path], sessionKey: 'catsco:grp_a', backend: 'catsco',
    }));

    await expect(page.locator('.agent-changes')).toContainText('1 file changed');
    await page.locator('.agent-change-main').first().click();
    await expect(page.locator('.tabs .tab').filter({ hasText: 'a.md' })).toBeVisible();

    stub.sock!.send(JSON.stringify(list('grp_b')));
    stub.sock!.send(JSON.stringify(ready('grp_b', [])));

    await expect(page.locator('.agent-changes')).toHaveCount(0);
    await expect(page.locator('.tabs .tab').filter({ hasText: 'a.md' })).toHaveCount(0);
    await expect(page.locator('.empty', { hasText: 'Open a file from the tree' })).toBeVisible();
  });
});
