import { expect, test } from '@playwright/test';
import { anyWorking, settleConversation, watchQuiet } from '../../apps/server/src/agent/catsco-settle.ts';
import type { CatsCoConversation } from '../../apps/server/src/catsco-chat.ts';

const conv = (id: string, working: boolean): CatsCoConversation => ({
  id, title: id, preview: '', isGroup: false, isTask: false, working,
});

/**
 * The cloud's task_status lags behind the answer, and a local-only runtime never
 * polls it — the Stop button used to stay on after the reply. These cover the
 * settle step that unlocks the panel.
 */
test.describe('cloud turn settlement', () => {
  test('clears working for the finished conversation only', () => {
    const before = [conv('a', true), conv('b', true)];
    const after = settleConversation(before, 'a');

    expect(after[0]!.working).toBe(false);
    expect(after[1]!.working).toBe(true);
    expect(after).not.toBe(before);
  });

  test('is a no-op when the conversation already settled', () => {
    const before = [conv('a', false)];
    expect(settleConversation(before, 'a')).toBe(before);
  });

  test('ignores an unknown or missing topic', () => {
    const before = [conv('a', true)];
    expect(settleConversation(before, 'zzz')).toBe(before);
    expect(settleConversation(before, undefined)).toBe(before);
  });

  test('always drops the status text of the finished turn', () => {
    const before = [{ ...conv('a', true), statusText: '正在运行' }];
    const after = settleConversation(before, 'a', '任务已完成');
    expect(after[0]!.statusText).toBe('任务已完成');
  });

  test('reports when anything is still running', () => {
    expect(anyWorking([conv('a', false), conv('b', true)])).toBe(true);
    expect(anyWorking([conv('a', false)])).toBe(false);
    expect(anyWorking([])).toBe(false);
  });
});

test.describe('transcript quiet watch', () => {
  const tail = { id: 42, role: 'assistant', text: 'done' };

  test('starts watching when the tail is the agent\'s message', () => {
    const first = watchQuiet(null, tail, 1_000);
    expect(first.state).toEqual({ id: 42, since: 1_000 });
    expect(first.settled).toBe(false);
  });

  test('settles once the answer has stopped changing', () => {
    const first = watchQuiet(null, tail, 1_000);
    const quiet = watchQuiet(first.state, tail, 4_000, 3_000);
    expect(quiet.settled).toBe(true);
  });

  test('a new message restarts the clock', () => {
    const first = watchQuiet(null, tail, 1_000);
    const next = watchQuiet(first.state, { ...tail, id: 43 }, 5_000, 3_000);
    expect(next.settled).toBe(false);
    expect(next.state).toEqual({ id: 43, since: 5_000 });
  });

  test('a trailing tool row is a step that can end the round', () => {
    // A round often ends right after a step, with no closing prose.
    const first = watchQuiet(null, { id: 1, role: 'tool', text: 'Command completed' }, 1_000);
    expect(first.state).toEqual({ id: 1, since: 1_000 });

    // Steps are slower than prose: 6s is not enough, 20s is.
    expect(watchQuiet(first.state, { id: 1, role: 'tool', text: 'x' }, 7_000).settled).toBe(false);
    expect(watchQuiet(first.state, { id: 1, role: 'tool', text: 'x' }, 21_000).settled).toBe(true);
  });

  test('a user row means no round is open', () => {
    expect(watchQuiet(null, { id: 2, role: 'user', text: 'x' }, 0).state).toBeNull();
    expect(watchQuiet(null, { id: 3, role: 'assistant', text: '  ' }, 0).state).toBeNull();
    expect(watchQuiet(null, undefined, 0).settled).toBe(false);
  });
});
