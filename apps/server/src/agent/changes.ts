import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  parseHunks, revertBlock,
  type AgentChange, type AgentChangeKind, type DiffHunk,
} from '@remotepad/shared';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

type Snap = {
  missing: boolean;
  binary: boolean;
  text: string | null;
  buf: Buffer | null;
};

type Entry = {
  original: Snap;
  current: Snap;
  diff: string;
};

/**
 * Buffer-level change tracking, one tracker per session.
 *
 * Only files a tool actually wrote are tracked. Git is not consulted: a dirty
 * file in the repo may come from another session, from you, or from something
 * unrelated, and reporting it here made every session look responsible for all
 * of them.
 *
 * Accepting moves the baseline to the current content, so an accepted change
 * leaves the list and stays gone until the file is written again. That is the
 * same model an agent IDE uses: the buffer you have is the reference.
 */
export class ChangeTracker {
  private entries = new Map<string, Entry>();
  /** Content the user already accepted; the reference for the next write. */
  private accepted = new Map<string, Snap>();
  /** Blocks the user explicitly kept, per file (ids survive re-diffs). */
  private kept = new Map<string, Set<string>>();
  /** Files the user edited themselves during review. */
  private edited = new Set<string>();
  /** Content this tracker wrote itself, to tell a decision from an outside write. */
  private written = new Map<string, string>();

  /** Persist the accepted baselines for this conversation.
   *
   * Keep is a promise that the file stops showing up. Holding it only in memory
   * broke that promise on the next restart: the reference fell back to HEAD, and
   * every kept file came back as a fresh change.
   */
  constructor(
    private readonly key = 'default',
    /** Where accepted baselines live; injectable so tests never touch $HOME. */
    private readonly baseDir = path.join(os.homedir(), '.remotepad', 'accepted'),
  ) {
    this.loadAccepted();
  }

  private acceptedFile(): string {
    const safe = this.key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.baseDir, `${safe}.json`);
  }

  private loadAccepted(): void {
    try {
      const raw = JSON.parse(fsSync.readFileSync(this.acceptedFile(), 'utf8')) as Record<string, string | null>;
      for (const [abs, text] of Object.entries(raw)) {
        this.accepted.set(abs, text === null
          ? { missing: true, binary: false, text: null, buf: null }
          : { missing: false, binary: false, text, buf: Buffer.from(text) });
      }
    } catch {
      // No saved baselines yet.
    }
  }

  private saveAccepted(): void {
    try {
      const out: Record<string, string | null> = {};
      for (const [abs, snap] of this.accepted) out[abs] = snap.missing ? null : snap.text;
      fsSync.mkdirSync(path.dirname(this.acceptedFile()), { recursive: true });
      fsSync.writeFileSync(this.acceptedFile(), JSON.stringify(out));
    } catch {
      // Losing the record only costs one extra diff later.
    }
  }

  list(): AgentChange[] {
    this.dropIgnored();
    return [...this.entries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, entry]) => {
        const change: AgentChange = {
          path: filePath,
          kind: kindOf(entry),
          binary: entry.original.binary || entry.current.binary,
          diff: entry.diff,
        };
        // Full text lets the editor render a line-level diff with keep / undo per line.
        const before = snapText(entry.original);
        const after = snapText(entry.current);
        if (before !== undefined && after !== undefined) {
          change.before = before;
          change.after = after;
        }
        // Block-level review: the hunks this diff is made of, and what has been
        // decided about them so far.
        const hunks = entry.current.binary ? [] : parseHunks(entry.diff);
        if (hunks.length) {
          change.hunks = hunks;
          const kept = this.kept.get(filePath);
          change.keptHunks = kept ? hunks.filter((h) => kept.has(h.id)).map((h) => h.id) : [];
        }
        if (this.edited.has(filePath)) change.userEdited = true;
        return change;
      });
  }

  /** Writes a line-edited version of a tracked file and re-diffs it. */
  async applyContent(filePath: string, content: string): Promise<string | null> {
    const abs = path.resolve(filePath);
    const entry = this.entries.get(abs);
    if (!entry || isRuntimePath(abs)) return null;
    if (entry.original.binary || entry.current.binary) return null;
    await fs.writeFile(abs, content, 'utf8');
    await this.refresh(abs);
    return abs;
  }

  /** Reference content for a file about to be written: accepted state, else disk. */
  async snapshotBeforeWrite(filePath: string): Promise<void> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs) || this.entries.has(abs)) return;
    const original = this.accepted.get(abs) ?? await readSnap(abs);
    this.entries.set(abs, { original, current: original, diff: '' });
  }

  /** Record a change whose "before" came from a turn snapshot, not a write hook. */
  async trackWithOriginal(filePath: string, before: string | null): Promise<boolean> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs)) return false;
    // A hook already captured the real pre-write content: keep that baseline.
    if (this.entries.has(abs)) return this.refresh(abs);
    // An accepted file is the reference, not git. Its caller may hand over HEAD
    // content (the file is still dirty versus git after Keep), and diffing from
    // HEAD resurrected a change the user had already accepted.
    const accepted = this.accepted.get(abs);
    if (accepted) {
      this.entries.set(abs, { original: accepted, current: accepted, diff: '' });
      return this.refresh(abs);
    }
    const original: Snap = before === null
      ? { missing: true, binary: false, text: null, buf: null }
      : { missing: false, binary: false, text: before, buf: Buffer.from(before) };
    const current = await readSnap(abs);
    if (snapsEqual(original, current)) return false;
    this.entries.set(abs, { original, current, diff: '' });
    return this.refresh(abs);
  }

  async refresh(filePath: string): Promise<boolean> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs)) {
      const existed = this.entries.delete(abs);
      return existed;
    }
    const existing = this.entries.get(abs);
    if (!existing && !this.accepted.has(abs)) return false;
    const original = existing?.original ?? this.accepted.get(abs)!;
    const current = await readSnap(abs);
    // Back to the reference (accepted or never written): nothing to report.
    if (snapsEqual(original, current)) {
      this.entries.delete(abs);
      return Boolean(existing);
    }
    const binary = original.binary || current.binary;
    const kind = kindOf({ original, current });
    const diff = binary
      ? `Binary file ${kind}\n`
      : await unifiedDiff(abs, original.missing ? null : original.text, current.missing ? null : current.text);
    this.entries.set(abs, { original, current, diff });
    return true;
  }

  /** The hunks of one file right now; used to describe a decision in the log. */
  hunksOf(filePath: string): DiffHunk[] {
    const entry = this.entries.get(path.resolve(filePath));
    return entry && !entry.current.binary ? parseHunks(entry.diff) : [];
  }

  /**
   * Keep or ignore one block.
   *
   * Keep records the decision and leaves the bytes alone (they are already the
   * agent's). Ignore rebuilds the file with every other block applied and this one
   * reverted — a real revert of one block, not a note beside it.
   */
  async decideHunk(filePath: string, hunkId: string, decision: 'keep' | 'ignore'): Promise<string[]> {
    const abs = path.resolve(filePath);
    const entry = this.entries.get(abs);
    if (!entry || isRuntimePath(abs)) return [];
    const hunks = parseHunks(entry.diff);
    if (!hunks.some((hunk) => hunk.id === hunkId)) return [];

    if (decision === 'keep') {
      const set = this.kept.get(abs) ?? new Set<string>();
      set.add(hunkId);
      this.kept.set(abs, set);
      return [abs];
    }

    const before = entry.original.binary ? '' : (entry.original.text ?? '');
    const next = revertBlock(before, entry.diff, hunkId);
    if (next === null) return [];
    await fs.writeFile(abs, next, 'utf8');
    this.written.set(abs, next);
    // The decision is history now: the block is gone from the file.
    this.kept.delete(abs);
    await this.refresh(abs);
    return [abs];
  }

  /** The user rewrote the file during review. Recorded, never inferred. */
  markUserEdited(filePath: string): void {
    this.edited.add(path.resolve(filePath));
  }

  async accept(filePath: string): Promise<string[]> {
    const abs = path.resolve(filePath);
    const entry = this.entries.get(abs);
    if (entry) this.accepted.set(abs, entry.current);
    this.entries.delete(abs);
    this.kept.delete(abs);
    this.edited.delete(abs);
    this.saveAccepted();
    return [abs];
  }

  async undo(filePath: string): Promise<string[]> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs)) {
      this.entries.delete(abs);
      return [];
    }
    const entry = this.entries.get(abs);
    if (!entry) return [];
    await restoreSnap(abs, entry.original);
    this.entries.delete(abs);
    // Undo puts the file back at the reference; keep that reference stable so a
    // later turn does not diff it against HEAD.
    this.accepted.set(abs, entry.original);
    this.saveAccepted();
    return [abs];
  }

  async acceptAll(): Promise<string[]> {
    this.dropIgnored();
    const paths = [...this.entries.keys()];
    for (const [abs, entry] of this.entries) this.accepted.set(abs, entry.current);
    this.entries.clear();
    this.kept.clear();
    this.edited.clear();
    this.saveAccepted();
    return paths;
  }

  async undoAll(): Promise<string[]> {
    this.dropIgnored();
    const paths = [...this.entries.keys()];
    for (const filePath of paths) {
      const entry = this.entries.get(filePath);
      if (entry) await restoreSnap(filePath, entry.original);
    }
    this.entries.clear();
    this.kept.clear();
    this.edited.clear();
    return paths;
  }

  /** Forgets entries owned by another session so they never show up here. */
  drop(paths: string[]): void {
    for (const filePath of paths) {
      const abs = path.resolve(filePath);
      this.entries.delete(abs);
      this.kept.delete(abs);
      this.edited.delete(abs);
    }
  }

  private dropIgnored(): void {
    for (const abs of this.entries.keys()) {
      if (isRuntimePath(abs)) this.entries.delete(abs);
    }
  }
}

function isInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function isRuntimePath(filePath: string): boolean {
  const abs = path.resolve(filePath);
  const roots = [
    path.resolve(config.xiaobaDataDir),
    path.join(os.homedir(), '.remotepad'),
    path.join(os.homedir(), '.xiaoba'),
  ];
  if (roots.some((root) => isInside(root, abs))) return true;
  const base = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  const grand = path.basename(path.dirname(path.dirname(abs)));
  if (parent === 'pet' && grand === 'data') return true;
  if (grand === 'data' && parent === 'sessions' && /^(rp-[a-z0-9]+|cli|remotepad)\.jsonl$/i.test(base)) return true;
  if (grand === 'data' && parent === 'session-state' && /^(rp-[a-z0-9]+|cli|remotepad)\.json$/i.test(base)) return true;
  return false;
}

async function readSnap(filePath: string): Promise<Snap> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) return { missing: true, binary: false, text: null, buf: null };
    if (stat.size > config.textSizeLimit) {
      return { missing: false, binary: true, text: null, buf: null };
    }
    const buf = await fs.readFile(filePath);
    if (buf.includes(0)) return { missing: false, binary: true, text: null, buf };
    return { missing: false, binary: false, text: buf.toString('utf8'), buf };
  } catch {
    return { missing: true, binary: false, text: null, buf: null };
  }
}

async function restoreSnap(filePath: string, snap: Snap): Promise<void> {
  if (snap.missing) {
    try { await fs.unlink(filePath); } catch { /* already gone */ }
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (snap.buf) await fs.writeFile(filePath, snap.buf);
  else await fs.writeFile(filePath, snap.text ?? '');
}

function snapsEqual(a: Snap, b: Snap): boolean {
  if (a.missing && b.missing) return true;
  if (a.missing !== b.missing) return false;
  if (a.binary || b.binary) {
    if (!a.buf || !b.buf) return false;
    return a.buf.equals(b.buf);
  }
  return a.text === b.text;
}

function kindOf(entry: Pick<Entry, 'original' | 'current'>): AgentChangeKind {
  if (entry.original.missing && !entry.current.missing) return 'create';
  if (!entry.original.missing && entry.current.missing) return 'delete';
  return 'modify';
}

/** Text body for the change list; undefined when binary / not useful for line diff. */
function snapText(snap: Snap): string | undefined {
  if (snap.binary) return undefined;
  if (snap.missing) return '';
  return snap.text ?? '';
}

async function unifiedDiff(filePath: string, before: string | null, after: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmpad-diff-'));
  try {
    const left = path.join(dir, 'a');
    const right = path.join(dir, 'b');
    await fs.writeFile(left, before ?? '');
    await fs.writeFile(right, after ?? '');
    try {
      const { stdout } = await execFileAsync('diff', [
        '-u',
        '--label', `a/${filePath}`,
        '--label', `b/${filePath}`,
        left,
        right,
      ], { maxBuffer: 4 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string };
      if (typeof execErr.stdout === 'string' && execErr.stdout) return execErr.stdout;
      return fallbackDiff(filePath, before ?? '', after ?? '');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function fallbackDiff(filePath: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.map((line) => `-${line}`),
    ...b.map((line) => `+${line}`),
  ].join('\n') + '\n';
}
