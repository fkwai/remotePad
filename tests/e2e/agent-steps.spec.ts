import { expect, test } from '@playwright/test';
import { fixture, gotoApp } from './support/app';

/**
 * The step counter must restart every round.
 *
 * Reported from use: "Executing · step 14" on the first step of a new round. The
 * label numbers the rows in one tool group, and groups were split only by a
 * non-tool message. Two rounds in a row where the first ends on a step and the
 * second starts with one — or a round started from the CatsCo app with no user
 * row in this transcript — therefore merged into a single group and the count
 * kept climbing.
 */
const ready = {
  type: 'ready', cwd: fixture.root, changes: [], sessions: [], history: [], backend: 'local',
};

type Stub = { send: (data: string) => void };

async function openStub(page: import('@playwright/test').Page) {
  const box: { sock?: Stub } = {};
  await page.routeWebSocket('**/ws/agent', (ws) => {
    box.sock = ws as unknown as Stub;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string };
      if (msg.type === 'hello') ws.send(JSON.stringify(ready));
    });
  });
  await gotoApp(page);
  const sock = box.sock!;
  const say = (payload: unknown) => sock.send(JSON.stringify(payload));
  // The panel resets to idle when the server's `ready` lands. Sending `running`
  // before that would be wiped, so wait until the box is usable (Send visible).
  await expect(page.locator('.agent-compose-row button.primary')).toBeVisible();
  return { page, say };
}

test.describe('agent step counter', () => {
  test('a second round starts again at step 1', async ({ page }) => {
    const { say } = await openStub(page);

    // Round 1: the agent works through twelve steps and ends on the last one.
    say({ type: 'user', text: 'first task' });
    say({ type: 'status', state: 'running' });
    for (let i = 1; i <= 12; i += 1) {
      say({ type: 'tool_start', name: `tool${i}`, id: `r1-${i}` });
      say({ type: 'tool_end', name: `tool${i}`, id: `r1-${i}`, ok: true, result: 'ok' });
    }
    const groups = page.locator('.agent-steps');
    await expect(groups).toHaveCount(1);
    // Live it reads "Executing · step 12"; once idle, "12 steps". Both are 12.
    await expect(groups.first()).toHaveText(/(step 12\b|12 steps)/);
    say({ type: 'status', state: 'idle' });

    // Round 2 starts with no prose of its own — the case that used to merge.
    say({ type: 'status', state: 'running' });
    say({ type: 'tool_start', name: 'read_file', id: 'r2-1' });

    await expect(groups).toHaveCount(2);
    const second = groups.last();
    // The bug: this said 13. Either label form is fine as long as the number is 1.
    await expect(second).toHaveText(/(step 1\b|^[▸▾]?\s*1 step)/);
    await expect(second).not.toHaveText(/step 13\b|13 steps/);
    // The first round's group is untouched and still readable.
    await expect(groups.first()).toHaveText(/(step 12\b|12 steps)/);
  });

  test('one round still counts up as it goes', async ({ page }) => {
    const { say } = await openStub(page);

    say({ type: 'user', text: 'task' });
    say({ type: 'status', state: 'running' });
    say({ type: 'tool_start', name: 'a', id: 'x1' });
    await expect(page.locator('.agent-steps')).toContainText('step 1');

    say({ type: 'tool_start', name: 'b', id: 'x2' });
    await expect(page.locator('.agent-steps')).toContainText('step 2');
    await expect(page.locator('.agent-steps')).toHaveCount(1);
  });
});
