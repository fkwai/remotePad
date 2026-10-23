/**
 * File / line references between the Editor and the Agent compose box.
 *
 * In the compose box a reference is a short token (`@a.md:12-20`) so the draft
 * stays readable. On send the token expands to a `[file]` block that carries
 * the absolute path (and the code, when it came from a copy). The transcript
 * renders those blocks back as a chip + collapsed code, so the compact view
 * survives a reload — the wire text is the source of truth.
 */

export interface AgentRef {
  path: string;
  name: string;
  /** `dir` is sent as `[dir]`; `term` is a terminal snippet tied to its cwd. */
  kind?: 'file' | 'dir' | 'term';
  startLine?: number;
  endLine?: number;
  /** Selected text, when the ref came from a copy. */
  text?: string;
  lang?: string;
  /** Token used inside the draft, without the leading `@`. */
  token: string;
}

export function refLabel(ref: Pick<AgentRef, 'name' | 'startLine' | 'endLine'>): string {
  if (!ref.startLine) return ref.name;
  const end = ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : '';
  return `${ref.name}:${ref.startLine}${end}`;
}

export function makeRef(input: {
  path: string;
  text?: string;
  startLine?: number;
  endLine?: number;
  lang?: string;
  kind?: 'file' | 'dir' | 'term';
  taken?: string[];
}): AgentRef {
  const name = input.path.split('/').filter(Boolean).pop() || input.path;
  const base = refLabel({ name, startLine: input.startLine, endLine: input.endLine });
  const taken = new Set(input.taken ?? []);
  let token = base;
  for (let i = 2; taken.has(token); i += 1) token = `${base}~${i}`;
  return {
    path: input.path,
    name,
    kind: input.kind,
    startLine: input.startLine,
    endLine: input.endLine,
    text: input.text,
    lang: input.lang,
    token,
  };
}

/** `[file] /abs/path:12-20` plus, for copy refs, a fenced body. */
export function renderRefBlock(ref: AgentRef): string {
  const range = ref.startLine
    ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}`
    : '';
  const head = `[${ref.kind ?? 'file'}] ${ref.path}${range}`;
  if (!ref.text) return head;
  const lang = ref.lang ?? (ref.kind === 'term' ? 'text' : '');
  return `${head}\n\`\`\`${lang}\n${ref.text.replace(/\n$/, '')}\n\`\`\``;
}

/**
 * Replace the tokens still present in the draft with their wire blocks.
 * Dropped/deleted tokens quietly drop out; the draft text alone decides.
 */
export function expandDraft(draft: string, refs: AgentRef[]): string {
  let out = draft;
  for (const ref of refs) {
    const token = `@${ref.token}`;
    if (!out.includes(token)) continue;
    out = out.split(token).join(renderRefBlock(ref));
  }
  return out;
}

export type WireSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; path: string; label: string; dir?: boolean; term?: boolean; code?: string; lang?: string };

const FILE_LINE = /^\[(file|dir|term)\] (.+?)(?::(\d+)(?:-(\d+))?)?$/;

/** Split a sent message into plain text and reference segments. */
export function parseWire(text: string): WireSegment[] {
  const lines = text.split('\n');
  const segments: WireSegment[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const chunk = buffer.join('\n').trim();
    if (chunk) segments.push({ kind: 'text', text: chunk });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const match = FILE_LINE.exec(lines[i].trim());
    if (!match) {
      buffer.push(lines[i]);
      continue;
    }
    flush();
    const [, label, path, start, end] = match;
    let code: string | undefined;
    let lang: string | undefined;
    const fence = lines[i + 1]?.trim();
    if (fence?.startsWith('```')) {
      lang = fence.slice(3).trim() || undefined;
      const body: string[] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '```') {
        body.push(lines[i]);
        i += 1;
      }
      code = body.join('\n');
    }
    const name = path.split('/').filter(Boolean).pop() || path;
    segments.push({
      kind: 'ref',
      path,
      dir: label === 'dir',
      term: label === 'term',
      label: label === 'term' ? 'terminal' : refLabel({
        name,
        startLine: start ? Number(start) : undefined,
        endLine: end ? Number(end) : undefined,
      }),
      code,
      lang,
    });
  }
  flush();
  return segments;
}

/** Last selection copied out of the editor, offered to the compose paste. */
let copied: {
  path: string;
  text: string;
  startLine?: number;
  endLine?: number;
  lang?: string;
  kind?: 'file' | 'dir' | 'term';
} | null = null;

export function rememberCopy(ref: NonNullable<typeof copied>) {
  copied = ref;
}

export function copiedSelection() {
  return copied;
}

/**
 * Compare clipboard text with the remembered selection.
 * Browsers normalise line endings and Monaco may keep trailing spaces, so a
 * byte comparison would reject a legitimate paste.
 */
export function sameClipboardText(a: string, b: string): boolean {
  const norm = (value: string) => value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return norm(a) !== '' && norm(a) === norm(b);
}

/** Forget the remembered selection once it has been turned into a token. */
export function clearCopied() {
  copied = null;
}
