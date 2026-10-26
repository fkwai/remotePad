import type { CatsCoConversation } from '../catsco-chat.ts';

/**
 * Clear the "working" flag for one conversation.
 *
 * The cloud's `task_status` is a hint that can lag behind the reply, and on a
 * local-only runtime no Dashboard polling corrects it. Once this runtime knows
 * the turn ended (the session file went quiet, or the tail stopped), the panel
 * must unlock — a Stop button that outlives the answer is worse than a flag
 * that settles a second early.
 */
export function settleConversation(
  conversations: CatsCoConversation[],
  topicId: string | undefined,
  statusText?: string,
): CatsCoConversation[] {
  if (!topicId) return conversations;
  let changed = false;
  const next = conversations.map((item) => {
    if (item.id !== topicId || !item.working) return item;
    changed = true;
    return { ...item, working: false, statusText: statusText ?? item.statusText };
  });
  return changed ? next : conversations;
}

/** True when any conversation still reports a running turn. */
export function anyWorking(conversations: CatsCoConversation[]): boolean {
  return conversations.some((item) => item.working);
}
