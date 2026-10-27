import { expect, test } from '@playwright/test';
import { decideSync, mayReload } from '../../apps/web/src/editorSync.ts';

/**
 * Why the caret jumped to the last line.
 *
 * The editor was bound as `value={tab.content}`. When that prop differed from the
 * model, `@monaco-editor/react` replaced the whole model with a full-range
 * `executeEdits`, and Monaco leaves the caret at the end of the replaced range —
 * i.e. the last line of the document. Anything that wrote `tab.content` from
 * outside (a disk reload, the Agent's change sync, a terminal "open" event) did
 * that while the reader was typing.
 *
 * These are the two rules that stop it: never push text over unsaved edits, and
 * never treat the editor's own output as external text.
 */
test.describe('editor sync', () => {
  test('the editor’s own text is never re-applied', () => {
    expect(decideSync({ emitted: 'abc', incoming: 'abc', dirty: true })).toBe('noop');
    expect(decideSync({ emitted: 'abc', incoming: 'abc', dirty: false })).toBe('noop');
  });

  test('external text is applied when the buffer has nothing unsaved', () => {
    // First load: the editor has not reported anything yet.
    expect(decideSync({ emitted: null, incoming: '# doc', dirty: false })).toBe('apply');
    // A disk reload while the tab is clean.
    expect(decideSync({ emitted: 'old', incoming: 'new', dirty: false })).toBe('apply');
  });

  test('text arriving while the reader has unsaved edits is ignored', () => {
    // This is the bug: 'new' would have replaced the model and moved the caret.
    expect(decideSync({ emitted: 'half typed', incoming: 'from disk', dirty: true })).toBe('keep');
    // Even the first load, if state somehow starts dirty, must not clobber.
    expect(decideSync({ emitted: null, incoming: 'x', dirty: true })).toBe('keep');
  });
});

test.describe('reload guard', () => {
  test('a clean or missing tab may reload', () => {
    expect(mayReload(undefined)).toBe(true);
    expect(mayReload({ dirty: false })).toBe(true);
  });

  test('a tab with unsaved edits is left alone', () => {
    expect(mayReload({ dirty: true })).toBe(false);
    // Unless the caller is explicit (the Revert command).
    expect(mayReload({ dirty: true }, { force: true })).toBe(true);
  });
});
