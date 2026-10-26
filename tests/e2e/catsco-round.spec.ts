import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { dashboardFile, gotoApp } from './support/app';

/**
 * A CatsCo round, asserted the way the user experiences it.
 *
 * The cloud is a stand-in Dashboard (tests/e2e/support/fake-dashboard.mjs) whose
 * state this spec rewrites, so the server runs its real poll path — the one that
 * kept the Stop button on when the cloud's task_status lagged behind the answer.
 *
 * What the user cares about, and what is asserted here:
 *   - while the agent works: Stop is offered and the input box refuses typing
 *   - when the answer lands: Send comes back and typing works again
 */
type Cloud = { taskState: 'running' | 'finished' | 'idle'; messages: Array<Record<string, unknown>> };

function setCloud(state: Cloud) {
  fs.writeFileSync(dashboardFile, JSON.stringify(state, null, 2));
}

const ask = { id: 1, role: 'user', content: 'plot the random scatter' };
const step = { id: 2, role: 'tool', name: 'execute_shell', content: 'Command completed' };
const answer = { id: 3, role: 'assistant', content: 'Done — the figure is open in the Plots panel.' };

test.describe('catsco round', () => {
  test('a finished answer gives the input box back, even if the cloud still says running', async ({ page }) => {
    setCloud({ taskState: 'running', messages: [ask, step] });

    await gotoApp(page);

    const compose = page.locator('.agent-compose-editor');
    const stop = page.locator('.agent-compose-row button.danger');
    const send = page.locator('.agent-compose-row button.primary');

    // The first poll lands within a couple of seconds; give the panel room.
    await expect(stop).toBeVisible({ timeout: 20_000 });
    await expect(send).toHaveCount(0);
    await expect(compose).toHaveAttribute('contenteditable', 'false');

    // The answer lands. The cloud's task_status is still "running" — that lag is
    // what used to leave the panel locked on Stop forever.
    setCloud({ taskState: 'running', messages: [ask, step, answer] });

    await expect(send).toBeVisible({ timeout: 20_000 });
    await expect(stop).toHaveCount(0);
    await expect(compose).toHaveAttribute('contenteditable', 'true');

    await compose.click();
    await page.keyboard.type('next round');
    await expect(compose).toContainText('next round');

    await expect(page.locator('.agent-msg.assistant').last()).toContainText('Done — the figure');
  });

  test('the answer arrives before the turn settles', async ({ page }) => {
    // Start from a quiet cloud, then let a round begin: the server remembers a
    // settled turn, so the transition is what this test has to produce.
    setCloud({ taskState: 'idle', messages: [] });
    await gotoApp(page);

    setCloud({ taskState: 'running', messages: [ask, step] });

    // Round in flight: the question is on screen and the only action is Stop.
    await expect(page.locator('.agent-compose-row button.danger')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.agent-msg.user').first()).toContainText('plot the random scatter', { timeout: 20_000 });

    setCloud({ taskState: 'finished', messages: [ask, step, answer] });

    await expect(page.locator('.agent-msg.assistant').last()).toContainText('Done — the figure', { timeout: 20_000 });
    await expect(page.locator('.agent-compose-row button.primary')).toBeVisible({ timeout: 20_000 });
  });
});
