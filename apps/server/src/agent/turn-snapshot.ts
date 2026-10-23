import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Content we already know: a file's state when the turn began, or null when absent. */
type Baseline = string | null;

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 400;

/**
 * What a turn changed, without trusting git's list.
 *
 * Git can only say "this file is dirty", which mixes in work from other
 * sessions and from your own edits. It is however a perfectly good *content
 * source*: HEAD holds what a clean file looked like when the turn started, and
 * a file that was already dirty is read and remembered here. At the end, only
 * files that actually moved during this turn are reported.
 */
export class TurnSnapshot {
  private root: string | null = null;
  private baseline = new Map<string, Baseline>();
  /** False after a finish: a second finish would have no baseline to compare. */
  private armed = false;

  async capture(startCwd: string): Promise<void> {
    this.root = await findRepoRoot(startCwd);
    this.baseline.clear();
    this.armed = Boolean(this.root);
    if (!this.root) return;
    const dirty = await this.dirtyFiles(this.root);
    let budget = MAX_TOTAL_BYTES;
    for (const rel of dirty.slice(0, MAX_FILES)) {
      const abs = path.join(this.root, rel);
      const text = await readText(abs, Math.min(budget, MAX_FILE_BYTES));
      if (typeof text === 'string') {
        this.baseline.set(rel, text);
        budget -= text.length;
      } else if (text === null) {
        this.baseline.set(rel, null);
      }
      if (budget <= 0) break;
    }
  }

  /** Files this turn changed, paired with what they looked like before it. */
  async finish(): Promise<Array<{ abs: string; before: Baseline }>> {
    const root = this.root;
    // Consumed. Without this, a second finish (send() then the poller) fell back
    // to HEAD for every dirty file — which re-reported changes the user had
    // already kept, and files this turn never touched at all.
    if (!root || !this.armed) return [];
    this.armed = false;
    const now = new Map<string, string>();
    for (const rel of await this.dirtyFiles(root)) now.set(rel, path.join(root, rel));

    // A file that was dirty at the start can change again while staying dirty,
    // so compare content rather than trusting the status list alone.
    for (const [rel, before] of this.baseline) {
      const abs = path.join(root, rel);
      if (now.has(rel) || before === null) continue;
      const current = await readText(abs, MAX_FILE_BYTES);
      if (current !== before) now.set(rel, abs);
    }

    const out: Array<{ abs: string; before: Baseline }> = [];
    for (const [rel, abs] of now) {
      const known = this.baseline.get(rel);
      const before = known !== undefined ? known : await headText(root, rel);
      out.push({ abs, before });
    }
    this.baseline.clear();
    return out;
  }

  private async dirtyFiles(root: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      const entries = stdout.split('\0').filter(Boolean);
      const rels: string[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const status = entry.slice(0, 2);
        const rel = entry.slice(3);
        // Renames carry the source path in the next record.
        if (status.includes('R') || status.includes('C')) i += 1;
        if (!rel || rel.startsWith('.git/')) continue;
        rels.push(rel);
      }
      return [...new Set(rels)];
    } catch {
      return [];
    }
  }
}

async function findRepoRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    try {
      const stat = await fs.lstat(path.join(current, '.git'));
      if (stat.isDirectory() || stat.isFile()) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Text of a file, or null when it does not exist; undefined when unusable. */
async function readText(abs: string, limit: number): Promise<string | null | undefined> {
  try {
    const stat = await fs.lstat(abs);
    if (!stat.isFile() || stat.size > limit) return undefined;
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) return undefined;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

async function headText(root: string, rel: string): Promise<Baseline> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'show', `HEAD:${rel}`], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    // Not in HEAD: the file is new for this turn.
    return null;
  }
}
