import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { applyHunks, parseHunks, revertBlock } from '../../packages/shared/src/hunks.ts';
import { ReviewLog } from '../../apps/server/src/agent/review.ts';

/**
 * Block review must be real file behaviour, and the record must say who did it.
 *
 * The maths is tested directly (`revertBlock` is what the tracker calls when you
 * press Ignore); the tracker itself imports config, which has `import.meta`, so
 * it cannot be loaded here — the wiring around these functions is covered by the
 * e2e spec and by hand in the preview.
 */
function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rp-review-'));
}

function unified(before: string, after: string): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-diff-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    try {
      return execFileSync('diff', ['-u', '--label', 'a/f', '--label', 'b/f', a, b], { encoding: 'utf8' });
    } catch (err) {
      return (err as { stdout?: string }).stdout ?? '';
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (n = 20) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test.describe('ignoring one block', () => {
  test('reverts that block and keeps the other applied', () => {
    const start = `${lines().join('\n')}\n`;
    const edited = lines();
    edited[1] = 'line 2 changed';
    edited[17] = 'line 18 changed';
    const diff = unified(start, `${edited.join('\n')}\n`);

    const hunks = parseHunks(diff);
    expect(hunks).toHaveLength(2);

    const reverted = revertBlock(start, diff, hunks[1]!.id)!;
    expect(reverted).toContain('line 2 changed');
    expect(reverted).not.toContain('line 18 changed');
    expect(reverted).toContain('line 18\n');
  });

  test('reverting every block restores the original byte for byte', () => {
    const start = `${lines().join('\n')}\n`;
    const edited = lines();
    edited[0] = 'first';
    edited[19] = 'last';
    const diff = unified(start, `${edited.join('\n')}\n`);
    const hunks = parseHunks(diff);

    // Apply the decision one at a time, as a user clicking through would.
    let current = start;
    let remaining = diff;
    for (const hunk of hunks) {
      const next = revertBlock(current, remaining, hunk.id);
      if (next === null) continue;
      current = next;
      remaining = unified(start, current) || '';
    }
    expect(current).toBe(start);
  });

  test('an unknown id is refused instead of writing an empty file', () => {
    const start = `${lines().join('\n')}\n`;
    const diff = unified(start, `${[...lines()].join('\n')}\nmodified\n`);
    expect(revertBlock(start, diff, 'deadbeef')).toBeNull();
  });

  test('keeping every block reproduces the agent version exactly', () => {
    const start = `${lines().join('\n')}\n`;
    const edited = lines();
    edited[1] = 'line 2 changed';
    const diff = unified(start, `${edited.join('\n')}\n`);
    const hunks = parseHunks(diff);
    expect(applyHunks(start, hunks, new Set(hunks.map((h) => h.id)))).toBe(`${edited.join('\n')}\n`);
  });
});

test.describe('review record', () => {
  test('says what happened per file, once', () => {
    const dir = tmp();
    const log = new ReviewLog('local:abc', dir);
    log.record({ path: '/repo/a.md', action: 'keep', detail: '+2 −0 · hello' });
    log.record({ path: '/repo/a.md', action: 'ignore', detail: '+5 −1 · old tail' });
    log.record({ path: '/repo/a.md', action: 'edited' });

    const context = log.takeContext()!;
    expect(context).toContain('local:abc');
    expect(context).toContain('/repo/a.md');
    expect(context).toContain('kept 1 block');
    expect(context).toContain('ignored 1 block');
    expect(context).toContain('+5 −1 · old tail');
    expect(context).toContain('edited the file yourself');
    expect(context).toContain('do not re-propose ignored blocks');
    // Consumed: the next message must not repeat yesterday's news.
    expect(log.takeContext()).toBeNull();
  });

  test('a session that only talked adds no prefix', () => {
    expect(new ReviewLog('local:silent', tmp()).takeContext()).toBeNull();
  });

  test('two sessions never share a record', () => {
    const dir = tmp();
    new ReviewLog('local:one', dir).record({ path: '/repo/a.md', action: 'keep' });
    const two = new ReviewLog('local:two', dir);

    expect(two.takeContext()).toBeNull();
    expect(two.summary()).toMatchObject({ sessionKey: 'local:two', events: 0 });
    expect(new ReviewLog('local:one', dir).takeContext()).toContain('/repo/a.md');
  });

  test('the record survives a restart, including what was already sent', () => {
    const dir = tmp();
    const first = new ReviewLog('catsco:grp_1', dir);
    first.record({ path: '/repo/b.ts', action: 'keep' });
    expect(first.takeContext()).toContain('/repo/b.ts');

    const reloaded = new ReviewLog('catsco:grp_1', dir);
    expect(reloaded.summary()).toMatchObject({ sessionKey: 'catsco:grp_1', events: 1, pending: 0 });
    expect(reloaded.takeContext()).toBeNull();

    reloaded.record({ path: '/repo/b.ts', action: 'edited' });
    expect(new ReviewLog('catsco:grp_1', dir).takeContext()).toContain('you edited the file');
  });
});
