/**
 * Deciding whether new text may be pushed into an editor that is being typed in.
 *
 * Monaco is bound as a controlled component (`value={tab.content}`). When that
 * prop differs from what the model holds, `@monaco-editor/react` replaces the
 * whole model with `executeEdits` over the full range — and Monaco puts the caret
 * at the end of the edited range. That is why the cursor teleported to the last
 * line of the document: something outside the editor (a disk reload, the Agent's
 * change sync, a terminal "open" event) wrote `tab.content` while the user typed.
 *
 * The rule here is deliberately blunt: text the user typed wins. Content arriving
 * from outside is applied only when the buffer has nothing unsaved.
 */
export interface SyncInput {
  /** Text the editor itself last reported (null before it has reported anything). */
  emitted: string | null;
  /** Text arriving from React state. */
  incoming: string;
  /** The tab has edits that are not on disk. */
  dirty: boolean;
}

export type SyncDecision =
  /** The editor already shows this; do nothing. */
  | 'noop'
  /** Apply the incoming text (nothing unsaved would be lost). */
  | 'apply'
  /** Keep what the user typed; the outside copy is stale or unwanted. */
  | 'keep';

export function decideSync({ emitted, incoming, dirty }: SyncInput): SyncDecision {
  if (emitted !== null && emitted === incoming) return 'noop';
  if (dirty) return 'keep';
  return 'apply';
}

/**
 * Whether a reload requested from outside (file watcher, terminal "open", revert)
 * may replace the buffer. Unsaved edits are the user's work: never drop them
 * silently — the caller keeps the tab and says so.
 */
export function mayReload(tab: { dirty: boolean } | undefined, opts?: { force?: boolean }): boolean {
  if (!tab) return true;
  return Boolean(opts?.force) || !tab.dirty;
}
