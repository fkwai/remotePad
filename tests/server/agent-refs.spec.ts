import { expect, test } from '@playwright/test';
import {
  clearCopied,
  copiedSelection,
  expandDraft,
  makeRef,
  parseWire,
  rememberCopy,
  refLabel,
  renderRefBlock,
} from '../../apps/web/src/agentRefs.ts';

/** Pure reference logic: tokens in the draft, `[file]` blocks on the wire. */

test.describe('agent references', () => {
  test('labels a file and a line range', () => {
    expect(refLabel({ name: 'App.tsx' })).toBe('App.tsx');
    expect(refLabel({ name: 'App.tsx', startLine: 4, endLine: 4 })).toBe('App.tsx:4');
    expect(refLabel({ name: 'App.tsx', startLine: 4, endLine: 9 })).toBe('App.tsx:4-9');
  });

  test('makes a token from the file name and disambiguates duplicates', () => {
    const first = makeRef({ path: '/srv/remotepad/apps/web/src/App.tsx', startLine: 4, endLine: 9 });
    expect(first.token).toBe('App.tsx:4-9');
    const second = makeRef({
      path: '/srv/other/App.tsx', startLine: 4, endLine: 9, taken: [first.token],
    });
    expect(second.token).toBe('App.tsx:4-9~2');
  });

  test('renders a wire block with the absolute path and optional code', () => {
    expect(renderRefBlock(makeRef({ path: '/srv/a/notes.md' })))
      .toBe('[file] /srv/a/notes.md');
    expect(renderRefBlock(makeRef({ path: '/srv/a/sub', kind: 'dir' })))
      .toBe('[dir] /srv/a/sub');
    expect(renderRefBlock(makeRef({
      path: '/srv/a/notes.md', startLine: 2, endLine: 3, lang: 'markdown', text: 'one\ntwo\n',
    }))).toBe('[file] /srv/a/notes.md:2-3\n```markdown\none\ntwo\n```');
  });

  test('expands only tokens still present in the draft', () => {
    const keep = makeRef({ path: '/srv/a/keep.ts', startLine: 1, endLine: 2, text: 'x\ny' });
    const removed = makeRef({ path: '/srv/a/removed.ts' });
    const draft = `look at @${keep.token} please`;
    expect(expandDraft(draft, [keep, removed]))
      .toBe('look at [file] /srv/a/keep.ts:1-2\n```\nx\ny\n``` please');
  });

  test('parses text + references back out of a sent message', () => {
    const sent = [
      'check this',
      '[file] /srv/a/keep.ts:1-2',
      '```ts',
      'const a = 1;',
      '```',
      '[file] /srv/a/notes.md',
      'and also the notes',
    ].join('\n');

    expect(parseWire(sent)).toEqual([
      { kind: 'text', text: 'check this' },
      {
        kind: 'ref',
        path: '/srv/a/keep.ts',
        dir: false,
        label: 'keep.ts:1-2',
        code: 'const a = 1;',
        lang: 'ts',
      },
      { kind: 'ref', path: '/srv/a/notes.md', dir: false, label: 'notes.md', code: undefined, lang: undefined },
      { kind: 'text', text: 'and also the notes' },
    ]);
  });

  test('keeps the last editor copy for the paste hand-off', () => {
    clearCopied();
    expect(copiedSelection()).toBeNull();

    rememberCopy({ path: '/srv/a/App.tsx', text: 'const a = 1;\n', startLine: 3, endLine: 3, lang: 'typescript' });
    expect(copiedSelection()).toMatchObject({
      path: '/srv/a/App.tsx', startLine: 3, endLine: 3, lang: 'typescript',
    });

    clearCopied();
    expect(copiedSelection()).toBeNull();
  });
});
