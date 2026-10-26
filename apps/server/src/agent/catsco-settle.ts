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

/** How long the transcript must stay unchanged before a turn counts as done. */
export const QUIET_MS = 6000;
/**
 * A step (tool_use / tool_result) at the tail also ends a round — often the last
 * thing the agent writes. Steps take longer than prose to finish, so they get a
 * wider window, but they must not be ignored: that is exactly how Stop stayed on.
 */
export const TOOL_QUIET_MS = 20_000;

export interface QuietWatch {
  /** Message id last seen at the tail of the transcript. */
  id: number;
  /** When that id was first seen. */
  since: number;
}

/**
 * Decide whether the turn is over by watching the transcript, not the cloud's
 * task_status.
 *
 * task_status is written by the cloud worker and can stay "running" long after
 * the answer landed (or forever, when the worker dies). A transcript whose last
 * message is the agent's and which has stopped growing is the signal we own.
 */
export function watchQuiet(
  prev: QuietWatch | null,
  tail: { id: number; role: string; text: string } | undefined,
  now: number,
  quietMs = QUIET_MS,
  toolQuietMs = TOOL_QUIET_MS,
): { state: QuietWatch | null; settled: boolean } {
  if (!tail) return { state: null, settled: false };
  const isAnswer = tail.role === 'assistant' && Boolean(tail.text.trim());
  const isStep = tail.role === 'tool';
  // A user row means the turn has not started yet (or is ours, already on screen).
  if (!isAnswer && !isStep) return { state: null, settled: false };
  if (!prev || prev.id !== tail.id) return { state: { id: tail.id, since: now }, settled: false };
  return { state: prev, settled: now - prev.since >= (isAnswer ? quietMs : toolQuietMs) };
}

/**
 * Is a cloud turn open right now?
 *
 * A round started from the CatsCo app never goes through send(), so `status`
 * can still be idle while the cloud is running. Gating the end-of-turn watch on
 * `status === 'running'` left the panel stuck on Stop forever.
 */
export function turnIsOpen(input: { sending: boolean; status: string; cloudWorking: boolean }): boolean {
  return input.sending || input.cloudWorking || input.status === 'running';
}

/** True when any conversation still reports a running turn. */
export function anyWorking(conversations: CatsCoConversation[]): boolean {
  return conversations.some((item) => item.working);
}
