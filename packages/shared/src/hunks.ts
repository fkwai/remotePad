/**
 * Block-level review of an agent's edit.
 *
 * A unified diff is the only thing both sides agree on, so review works on it:
 * split it into hunks (the "blocks" you keep or ignore), and rebuild the file with
 * the kept blocks applied and the ignored blocks reverted. That is what makes
 * block decisions real file state instead of a note next to the diff.
 *
 * Kept in @remotepad/shared so the browser and the server parse identically —
 * a block the UI shows must be the block the server applies.
 */
export interface DiffHunk {
  /** Stable across re-diffs: hash of the header and body. */
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  added: number;
  removed: number;
  /** One-line description, e.g. `+3 −1 · export function sync()`. */
  label: string;
  /** Body lines including their marker (' ', '+', '-'). */
  lines: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function hash(text: string): string {
  // FNV-1a, 32-bit: enough to identify a block, no crypto import in the browser.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A line worth showing next to a block: the first thing that actually changed. */
function labelOf(lines: string[]): string {
  const changed = lines.find((line) => line.startsWith('+') || line.startsWith('-'));
  if (!changed) return '';
  return changed.slice(1).trim().slice(0, 60);
}

export function parseHunks(diff: string): DiffHunk[] {
  const out: DiffHunk[] = [];
  const rows = diff.split('\n');
  let current: DiffHunk | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    // A diff ends with a newline, so split leaves one empty row. Treating it as a
    // blank context line added a phantom line to every applied file.
    if (row === '' && index === rows.length - 1) continue;
    const match = HUNK_HEADER.exec(row);
    if (match) {
      if (current) out.push(finish(current));
      current = {
        id: '',
        header: row,
        oldStart: Number(match[1]) || 0,
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]) || 0,
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        added: 0,
        removed: 0,
        label: '',
        lines: [],
      };
      continue;
    }
    if (!current) continue; // file headers, index lines, "diff --git"
    // "\ No newline at end of file" is metadata, not content.
    if (row.startsWith('\\')) continue;
    // Some tools emit a bare blank line for a blank context line; keep it as
    // context. (A trailing one is handled above.)
    if (row === '') { current.lines.push(' '); continue; }
    const mark = row[0];
    if (mark !== ' ' && mark !== '+' && mark !== '-') continue;
    current.lines.push(row);
    if (mark === '+') current.added += 1;
    if (mark === '-') current.removed += 1;
  }
  if (current) out.push(finish(current));
  return out;

  function finish(hunk: DiffHunk): DiffHunk {
    // Only the body: the header carries line numbers, which shift as soon as one
    // block is applied or reverted, and an id must survive that.
    const body = hunk.lines.join('\n');
    return {
      ...hunk,
      id: hash(body),
      label: hunk.label || labelOf(hunk.lines),
    };
  }
}

function toLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

/**
 * Rebuild the file with some blocks applied and the rest reverted.
 *
 * `keep` holds the ids of blocks to apply; every other block falls back to the
 * original text. Untouched regions are copied from `before`, so a file with no
 * decisions comes back byte-identical.
 */
export function applyHunks(before: string, hunks: DiffHunk[], keep: ReadonlySet<string>): string {
  const source = toLines(before);
  const out: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = Math.max(0, (hunk.oldStart || 1) - 1);
    while (cursor < start && cursor < source.length) out.push(source[cursor++]!);

    const kept = keep.has(hunk.id);
    for (const line of hunk.lines) {
      const body = line.slice(1);
      if (line[0] === ' ') out.push(body);
      else if (line[0] === '-') { if (!kept) out.push(body); }
      else if (line[0] === '+') { if (kept) out.push(body); }
    }
    // Jump past whatever this hunk covered on the old side.
    cursor = start + hunk.oldCount;
  }

  while (cursor < source.length) out.push(source[cursor++]!);
  const joined = out.join('\n');
  return before.endsWith('\n') && joined !== '' ? `${joined}\n` : joined;
}

/**
 * The file with one block reverted and the rest applied.
 *
 * This is the whole point of block review: "ignore" must yield a file, not a
 * comment. Returns null when the id is not in this diff, so a stale UI cannot
 * silently rewrite something.
 */
export function revertBlock(before: string, diff: string, hunkId: string): string | null {
  const hunks = parseHunks(diff);
  if (!hunks.some((hunk) => hunk.id === hunkId)) return null;
  const keep = new Set(hunks.filter((hunk) => hunk.id !== hunkId).map((hunk) => hunk.id));
  return applyHunks(before, hunks, keep);
}

/** Human summary of one block, for the review record. */
export function describeHunk(hunk: DiffHunk): string {
  const parts = [`+${hunk.added}`, `−${hunk.removed}`];
  return hunk.label ? `${parts.join(' ')} · ${hunk.label}` : parts.join(' ');
}
