import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { copyInto, copyName } from '../../apps/server/src/fs-copy.ts';

/** Copying files: the naming rule, and the refusals that protect the tree. */

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rp-copy-'));
}

test.describe('copy names', () => {
  test('keeps the extension at the end', () => {
    expect(copyName('notes.md', new Set())).toBe('notes copy.md');
    expect(copyName('archive.tar.gz', new Set())).toBe('archive.tar copy.gz');
    expect(copyName('Makefile', new Set())).toBe('Makefile copy');
  });

  test('numbers the second and later copies', () => {
    expect(copyName('a.md', new Set(['a copy.md']))).toBe('a copy 2.md');
    expect(copyName('a.md', new Set(['a copy.md', 'a copy 2.md']))).toBe('a copy 3.md');
  });
});

test.describe('copy into a folder', () => {
  test('copies a file next to itself without touching the original', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.md'), '# alpha\n');

    const first = await copyInto({ from: path.join(dir, 'a.md'), into: dir });
    expect(path.basename(first.to)).toBe('a copy.md');
    expect(fs.readFileSync(first.to, 'utf8')).toBe('# alpha\n');
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('# alpha\n');

    const second = await copyInto({ from: path.join(dir, 'a.md'), into: dir });
    expect(path.basename(second.to)).toBe('a copy 2.md');
  });

  test('copies a whole folder with its contents', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'pkg', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pkg', 'inner', 'x.ts'), 'export {};\n');

    const result = await copyInto({ from: path.join(dir, 'pkg'), into: dir });
    expect(path.basename(result.to)).toBe('pkg copy');
    expect(fs.readFileSync(path.join(result.to, 'inner', 'x.ts'), 'utf8')).toBe('export {};\n');
  });

  test('keeps the name when pasting into a folder that lacks it', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'target'));
    fs.writeFileSync(path.join(dir, 'a.md'), 'a\n');

    const result = await copyInto({ from: path.join(dir, 'a.md'), into: path.join(dir, 'target') });
    expect(path.basename(result.to)).toBe('a.md');
    expect(fs.existsSync(path.join(dir, 'a.md'))).toBe(true);
  });

  test('honours an explicit destination name', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'a\n');
    const result = await copyInto({ from: path.join(dir, 'a.md'), into: dir, as: 'renamed.md' });
    expect(path.basename(result.to)).toBe('renamed.md');
  });

  test('refuses to overwrite an existing file', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'a\n');
    await expect(
      copyInto({ from: path.join(dir, 'a.md'), into: dir, as: 'a.md' }),
    ).rejects.toThrow(/exist/i);
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('a\n');
  });

  test('refuses to copy a folder into itself', async () => {
    const dir = tmp();
    const pkg = path.join(dir, 'pkg');
    fs.mkdirSync(path.join(pkg, 'inner'), { recursive: true });
    await expect(copyInto({ from: pkg, into: pkg })).rejects.toThrow(/into itself/i);
    await expect(copyInto({ from: pkg, into: path.join(pkg, 'inner') })).rejects.toThrow(/into itself/i);
    // Nothing was created by the refused attempts.
    expect(fs.readdirSync(pkg)).toEqual(['inner']);
  });

  test('refuses a destination that is not a folder', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'a\n');
    fs.writeFileSync(path.join(dir, 'b.md'), 'b\n');
    await expect(
      copyInto({ from: path.join(dir, 'a.md'), into: path.join(dir, 'b.md') }),
    ).rejects.toThrow(/not a folder/i);
  });
});
