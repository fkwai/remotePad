import { expect, test } from '@playwright/test';
import { parseHunks } from '../../packages/shared/src/hunks.ts';
import { fixture, gotoApp } from './support/app';

/**
 * Block-by-block review, as the user drives it.
 *
 * Two independent edits give two blocks; Keep records a decision, Ignore sends a
 * revert for that block only. The panel must also show which files the user
 * edited themselves, because that is what the next message reports back.
 */
const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const after = (() => {
  const rows = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  rows[1] = 'line 2 changed';
  rows[17] = 'line 18 changed';
  return `${rows.join('\n')}\n`;
})();

/**
 * The exact `diff -u` output for those two edits (two hunks, header counts
 * included). Written out rather than generated so the test does not depend on the
 * local `diff` binary — the parser is what is under test here.
 */
const diff = [
  '--- a/notes.md',
  '+++ b/notes.md',
  '@@ -1,5 +1,5 @@',
  ' line 1',
  '-line 2',
  '+line 2 changed',
  ' line 3',
  ' line 4',
  ' line 5',
  '@@ -15,6 +15,6 @@',
  ' line 15',
  ' line 16',
  ' line 17',
  '-line 18',
  '+line 18 changed',
  ' line 19',
  ' line 20',
  '',
].join('\n');

const hunks = parseHunks(diff);

const change = {
  path: fixture.markdown,
  kind: 'M',
  diff,
  before,
  after,
  hunks,
  keptHunks: [] as string[],
  userEdited: false,
};

type Sent = Record<string, unknown>;

async function openReview(page: import('@playwright/test').Page, echo: (msg: Sent) => Sent | null) {
  const sent: Sent[] = [];
  await page.routeWebSocket('**/ws/agent', (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as Sent;
      if (msg.type === 'hello') {
        ws.send(JSON.stringify({
          type: 'ready', cwd: fixture.root, changes: [], sessions: [], history: [], backend: 'local',
        }));
        ws.send(JSON.stringify({ type: 'changes', files: [change], touched: [change.path] }));
        return;
      }
      if (msg.type === 'hunk' || msg.type === 'review_edited') {
        sent.push(msg);
        const reply = echo(msg);
        if (reply) ws.send(JSON.stringify({ type: 'changes', files: [reply], touched: [change.path] }));
      }
    });
  });
  await gotoApp(page);
  await page.locator('.agent-change-main').first().click();
  await expect(page.locator('.review-blocks')).toBeVisible();
  return sent;
}

test.describe('block review', () => {
  test('shows one row per block with its size', async ({ page }) => {
    await openReview(page, () => null);

    const rows = page.locator('.review-block');
    await expect(rows).toHaveCount(2);
    // The label is the first changed line, which for a replacement is the removed
    // one — that is what you want to see before deciding.
    await expect(rows.nth(0).locator('.review-block-meta')).toContainText('line 2');
    await expect(rows.nth(1).locator('.review-block-meta')).toContainText('line 18');
    await expect(rows.nth(0).locator('button')).toHaveText(['Keep', 'Ignore']);
  });

  test('Ignore sends a revert for that block only', async ({ page }) => {
    let sentId = '';
    const sent = await openReview(page, (msg) => {
      sentId = String(msg.id);
      // Server reverts block 2: one block left, nothing kept.
      return { ...change, hunks: [hunks[0]!], keptHunks: [] };
    });

    await page.locator('.review-block').nth(1).getByRole('button', { name: 'Ignore' }).click();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'hunk', path: change.path, decision: 'ignore' });
    expect(sentId).toBe(hunks[1]!.id);

    // The reverted block is gone; the other is still there to decide.
    await expect(page.locator('.review-block')).toHaveCount(1);
    await expect(page.locator('.review-block-meta')).toContainText('line 2');
  });

  test('Keep marks the block as settled', async ({ page }) => {
    const sent = await openReview(page, (msg) => ({
      ...change,
      keptHunks: [String(msg.id)],
    }));

    await page.locator('.review-block').nth(0).getByRole('button', { name: 'Keep' }).click();

    expect(sent[0]).toMatchObject({ type: 'hunk', decision: 'keep' });
    const kept = page.locator('.review-block.kept');
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText('kept');
    // A settled block offers no further decision.
    await expect(kept.locator('button')).toHaveCount(0);
  });

  test('editing the file yourself is reported once', async ({ page }) => {
    const sent = await openReview(page, (msg) => (
      msg.type === 'review_edited' ? { ...change, userEdited: true } : null
    ));

    const editor = page.locator('.diff-monaco, .diff-view').first();
    await expect(editor).toBeVisible();
    // The review buffer is editable; typing marks the file as user-edited.
    await page.locator('.monaco-editor').last().click();
    await page.keyboard.type('x');

    await expect.poll(() => sent.filter((msg) => msg.type === 'review_edited').length).toBe(1);
    await expect(page.locator('.review-blocks-edited')).toContainText('you edited this file');
  });
});
