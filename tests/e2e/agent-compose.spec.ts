import { expect, test } from '@playwright/test';
import { fixture, gotoApp } from './support/app';

/**
 * The Agent dock without a real agent runtime: /ws/agent is stubbed, so these
 * tests cover the compose box (drop → inline token) and the transcript
 * (ref chip, markdown answer) deterministically.
 */
test.describe('agent compose', () => {
  test('dropping a file inserts a filename token but sends the full path', async ({ page }) => {
    const sent: string[] = [];
    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string; text?: string };
        if (msg.type === 'hello') {
          ws.send(JSON.stringify({
            type: 'ready', cwd: '/', changes: [], sessions: [], history: [], backend: 'local',
          }));
        }
        if (msg.type === 'send' && msg.text) {
          sent.push(msg.text);
          ws.send(JSON.stringify({ type: 'user', text: msg.text }));
          ws.send(JSON.stringify({ type: 'text', text: '**bold** answer\n\n- one\n- two' }));
          ws.send(JSON.stringify({ type: 'status', state: 'idle' }));
        }
      });
    });

    await gotoApp(page);
    const compose = page.locator('.agent-compose-editor');
    await expect(compose).toBeVisible();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.evaluate(([target, path]) => {
      (target as DataTransfer).setData(
        'application/x-remotepad-entry',
        JSON.stringify({ path, kind: 'file', name: 'a.md' }),
      );
    }, [dataTransfer, fixture.markdown] as never);

    await compose.dispatchEvent('drop', { dataTransfer });

    // The draft holds a colored chip, not a @token…
    const chip = compose.locator('.agent-ref-chip');
    await expect(chip).toHaveText('a.md');
    await expect(compose).not.toContainText(fixture.markdown);

    // …typing continues next to it.
    await compose.click();
    await page.keyboard.type('please review');

    await page.getByRole('button', { name: 'Send' }).click();

    // …the agent receives the absolute path…
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`[file] ${fixture.markdown}`);
    expect(sent[0]).toContain('please review');

    // …and the transcript collapses it back into a chip.
    await expect(page.locator('.agent-ref').first()).toHaveText('a.md');
  });

  test('renders an agent reply as markdown', async ({ page }) => {
    await page.routeWebSocket('**/ws/agent', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { type?: string; text?: string };
        if (msg.type === 'hello') {
          ws.send(JSON.stringify({
            type: 'ready', cwd: '/', changes: [], sessions: [], history: [], backend: 'local',
          }));
        }
        if (msg.type === 'send') {
          ws.send(JSON.stringify({ type: 'user', text: msg.text ?? '' }));
          ws.send(JSON.stringify({
            type: 'text',
            text: '## Plan\n\nUse **bold**, `code`, and a list:\n\n1. first\n2. second\n',
          }));
          ws.send(JSON.stringify({ type: 'status', state: 'idle' }));
        }
      });
    });

    await gotoApp(page);
    const compose = page.locator('.agent-compose-editor');
    await compose.fill('hello');
    await page.getByRole('button', { name: 'Send' }).click();

    const answer = page.locator('.agent-md').last();
    await expect(answer.locator('h2')).toHaveText('Plan');
    await expect(answer.locator('strong')).toHaveText('bold');
    await expect(answer.locator('code')).toHaveText('code');
    await expect(answer.locator('ol li')).toHaveCount(2);
    // Raw markdown must not leak into the transcript.
    await expect(answer).not.toContainText('## Plan');
    await expect(page.locator('.agent-msg.assistant').last()).not.toContainText('**bold**');
  });
});
