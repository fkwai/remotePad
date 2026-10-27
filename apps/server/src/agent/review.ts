import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentChange } from '@remotepad/shared';

export type ReviewAction = 'keep' | 'ignore' | 'keep-all' | 'undo-all' | 'edited';

export interface ReviewEvent {
  at: number;
  path: string;
  action: ReviewAction;
  /** Block id, for keep/ignore. */
  hunk?: string;
  /** Human description of the block, e.g. `+3 −1 · export function sync()`. */
  detail?: string;
}

interface Stored {
  sessionKey: string;
  events: ReviewEvent[];
  /** How many events were already carried into a message. */
  carried: number;
}

/**
 * What this session did to the agent's code, and what it has told the agent about.
 *
 * Two problems this exists for:
 *  - "keep all / ignore all" left no trace, so the next message could not say what
 *    was accepted and the agent happily re-proposed ignored edits;
 *  - with several sessions open, nothing recorded which conversation touched
 *    which file.
 *
 * The log is per session (the tracker key: `local:<id>` / `catsco:<topic>`), so
 * one conversation can never claim another's edits. Events are consumed once: a
 * message carries what happened since the previous message, not the whole history.
 */
export class ReviewLog {
  private events: ReviewEvent[] = [];
  private carried = 0;

  constructor(
    private readonly key: string,
    /** Where the record lives; injectable so tests never touch $HOME. */
    private readonly baseDir = path.join(os.homedir(), '.remotepad', 'reviews'),
  ) {
    this.load();
  }

  private file(): string {
    const safe = this.key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.baseDir, `${safe}.json`);
  }

  private load(): void {
    try {
      const raw = JSON.parse(fsSync.readFileSync(this.file(), 'utf8')) as Stored;
      if (!Array.isArray(raw.events)) return;
      this.events = raw.events.filter((item) => typeof item?.path === 'string');
      this.carried = Math.min(Math.max(0, Number(raw.carried) || 0), this.events.length);
    } catch {
      // No record yet.
    }
  }

  private save(): void {
    try {
      fsSync.mkdirSync(path.dirname(this.file()), { recursive: true });
      fsSync.writeFileSync(this.file(), JSON.stringify({
        sessionKey: this.key,
        events: this.events,
        carried: this.carried,
      } satisfies Stored, null, 2));
    } catch {
      // A lost record costs one message of context, not correctness.
    }
  }

  record(event: Omit<ReviewEvent, 'at'> & { at?: number }): void {
    this.events.push({ ...event, at: event.at ?? Date.now() });
    // Keep the file bounded: older events are still history, not noise we need.
    if (this.events.length > 400) {
      const drop = this.events.length - 400;
      this.events.splice(0, drop);
      this.carried = Math.max(0, this.carried - drop);
    }
    this.save();
  }

  /** Events not yet carried into a message. */
  pending(): ReviewEvent[] {
    return this.events.slice(this.carried);
  }

  /**
   * Text to prepend to the next message, then mark it as delivered.
   *
   * Empty when nothing happened: a session that only talked must not grow a
   * context block on every turn.
   */
  takeContext(): string | null {
    const pending = this.pending();
    if (pending.length === 0) return null;
    this.carried = this.events.length;
    this.save();
    return this.render(pending);
  }

  /** Same text, without consuming it: for the panel and for `curl`. */
  peekContext(): string | null {
    const pending = this.pending();
    return pending.length === 0 ? null : this.render(pending);
  }

  private render(pending: ReviewEvent[]): string {
    const byPath = new Map<string, ReviewEvent[]>();
    for (const event of pending) {
      const list = byPath.get(event.path) ?? [];
      list.push(event);
      byPath.set(event.path, list);
    }

    const lines = [`[review] ${this.key} — what you changed since the last message, and what was decided`];
    for (const [filePath, events] of byPath) {
      const counts = { keep: 0, ignore: 0, 'keep-all': 0, 'undo-all': 0, edited: 0 };
      const ignored: string[] = [];
      for (const event of events) {
        counts[event.action] += 1;
        if (event.action === 'ignore' && event.detail) ignored.push(event.detail);
      }
      const parts: string[] = [];
      if (counts.keep) parts.push(`kept ${counts.keep} block${counts.keep === 1 ? '' : 's'}`);
      if (counts.ignore) parts.push(`ignored ${counts.ignore} block${counts.ignore === 1 ? '' : 's'}`);
      if (counts['keep-all']) parts.push('kept everything');
      if (counts['undo-all']) parts.push('undid everything');
      if (counts.edited) parts.push('you edited the file yourself');
      if (ignored.length) parts.push(`ignored: ${ignored.slice(0, 3).join(' | ')}`);
      lines.push(`[review] ${filePath}: ${parts.join(', ') || 'no decision'}`);
    }
    lines.push('[review] Treat kept blocks as settled; do not re-propose ignored blocks unless asked.');
    return lines.join('\n');
  }

  /** Files this session has a decision about, newest last. */
  files(): Array<{ path: string; events: number }> {
    const counts = new Map<string, number>();
    for (const event of this.events) counts.set(event.path, (counts.get(event.path) ?? 0) + 1);
    return [...counts.entries()].map(([path, events]) => ({ path, events }));
  }

  /** Snapshot for diagnostics. */
  summary(): { sessionKey: string; events: number; pending: number } {
    return { sessionKey: this.key, events: this.events.length, pending: this.pending().length };
  }
}

/** Which files this session touched, for the "who changed what" question. */
export function touchedBy(events: ReviewEvent[]): string[] {
  return [...new Set(events.map((event) => event.path))];
}

/** Convenience for the API: the review state of a change list. */
export function reviewStateOf(change: AgentChange): { kept: string[]; edited: boolean } {
  return { kept: change.keptHunks ?? [], edited: Boolean(change.userEdited) };
}
