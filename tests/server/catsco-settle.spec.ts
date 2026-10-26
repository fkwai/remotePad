import { expect, test } from '@playwright/test';
import { anyWorking, settleConversation } from '../../apps/server/src/agent/catsco-settle.ts';
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
