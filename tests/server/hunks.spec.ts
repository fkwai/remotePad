import { expect, test } from '@playwright/test';
import { applyHunks, describeHunk, parseHunks } from '../../packages/shared/src/hunks.ts';

/**
 * A unified diff is the only shape both the browser and the server agree on, so
 * block review splits it into hunks and rebuilds the file from the decisions.
 * Getting this wrong silently corrupts a file, so it is tested on its own.
 */
const DIFF = [
  '--- a/notes.md',
  '+++ b/notes.md',
  '@@ -1,5 +1,6 @@',
  ' # Title',
  '+A new line at the top',
  ' ',
  ' Body text.',
  ' ',
  '-old tail',
  '+new tail',
  '+and one more',
  '',
].join('\n');

test.describe('parse hunks', () => {
  test('splits a diff into blocks with counts and labels', () => {
    const hunks = parseHunks(DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ added: 3, removed: 1, oldStart: 1, oldCount: 5, newStart: 1, newCount: 6 });
    expect(hunks[0]!.label).toContain('A new line at the top');
    expect(describeHunk(hunks[0]!)).toBe('+3 −1 · A new line at the top');
  });

  test('two distant edits are two blocks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const before = `${lines.join('\n')}\n`;
    const after = [...lines];
    after[1] = 'line 2 changed';
    after[17] = 'line 18 changed';
    const diff = unified(before, `${after.join('\n')}\n`);
    expect(parseHunks(diff)).toHaveLength(2);
  });

  test('ignores file headers and the no-newline marker', () => {
    const hunks = parseHunks(DIFF);
    expect(hunks[0]!.lines.every((line) => '/+- '.includes(line[0] ?? ''))).toBe(true);
  });

  test('ids survive a line shift', () => {
    // Same block, different header numbers: one block was applied above it.
    const shifted = DIFF.replace('@@ -1,5 +1,6 @@', '@@ -11,5 +12,6 @@');
    expect(parseHunks(DIFF)[0]!.id).toBe(parseHunks(shifted)[0]!.id);
  });
});

test.describe('apply blocks', () => {
  const before = '# Title\n\nBody text.\n\nold tail\n';

  test('keeping every block reproduces the agent version', () => {
    const hunks = parseHunks(DIFF);
    const keep = new Set(hunks.map((hunk) => hunk.id));
    expect(applyHunks(before, hunks, keep)).toBe(
      '# Title\nA new line at the top\n\nBody text.\n\nnew tail\nand one more\n',
    );
  });

  test('ignoring every block restores the original', () => {
    const hunks = parseHunks(DIFF);
    expect(applyHunks(before, hunks, new Set())).toBe(before);
  });

  test('keeping one block and ignoring the other touches only one region', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const start = `${lines.join('\n')}\n`;
    const edited = [...lines];
    edited[1] = 'line 2 changed';
    edited[17] = 'line 18 changed';
    const hunks = parseHunks(unified(start, `${edited.join('\n')}\n`));
    expect(hunks).toHaveLength(2);

    // Keep the first block only: the second must come back as it was.
    const kept = applyHunks(start, hunks, new Set([hunks[0]!.id]));
    expect(kept).toContain('line 2 changed');
    expect(kept).toContain('line 18\n');
    expect(kept).not.toContain('line 18 changed');
    expect(kept.split('\n')).toHaveLength(21);
  });

  test('a file without trailing newline keeps its shape', () => {
    const bare = 'a\nb';
    const hunks = parseHunks(unified(bare, 'a\nB'));
    expect(applyHunks(bare, hunks, new Set())).toBe(bare);
    expect(applyHunks(bare, hunks, new Set(hunks.map((h) => h.id)))).toBe('a\nB');
  });
});

/** Minimal unified diff, so the parser is tested against real `diff -u` output. */
function unified(before: string, after: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-hunk-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    try {
      return execFileSync('diff', ['-u', '--label', 'a/f', '--label', 'b/f', a, b], { encoding: 'utf8' });
    } catch (err) {
      // `diff` exits 1 when the files differ, which is the normal case here.
      return (err as { stdout?: string }).stdout ?? '';
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
