import { memo, useCallback, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { expandPhysics, KATEX_MACROS } from '../../typoraMath';
import { dirname } from '../../files';
import 'katex/dist/katex.min.css';

/**
 * Rendered markdown with Typora-style in-place editing.
 *
 * The document is split into top-level blocks. Every untouched block keeps its
 * exact source text, so rendering + editing never reformats the rest of the
 * file. Clicking a block swaps that block for a raw-markdown editor in the same
 * place (content is written through onChange as you type); leaving the block
 * renders it again. Source mode (`Ctrl/⌘+L`) stays available for markdown that
 * needs full syntax help.
 */

interface Chunk {
  /** block source, no trailing blank lines */
  body: string;
  /** the blank lines that followed this block (kept verbatim) */
  trail: string;
}

interface Doc {
  lead: string;
  chunks: Chunk[];
}

interface EditState {
  index: number;
  draft: string;
  original: string;
  caret: number;
  base: Doc;
}

export function MarkdownView({
  content,
  path,
  onChange,
}: {
  content: string;
  path: string;
  onChange?: (content: string) => void;
}) {
  const parsed = useMemo(() => splitChunks(content), [content]);
  const doc: Doc = parsed.chunks.length ? parsed : { lead: parsed.lead, chunks: [{ body: '', trail: '' }] };
  const docRef = useRef(doc);
  docRef.current = doc;

  const [edit, setEdit] = useState<EditState | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef(0);

  const write = useCallback((base: Doc, index: number, body: string) => {
    if (!onChange) return;
    onChange(base.lead + base.chunks.map((c, i) => (i === index ? body : c.body) + c.trail).join(''));
  }, [onChange]);

  const startEdit = useCallback((index: number, clientY: number, rect: DOMRect) => {
    const base = docRef.current;
    const chunk = base.chunks[index];
    if (!chunk) return;
    const body = chunk.body;
    let caret = body.length;
    if (rect.height > 0) {
      const ratio = (clientY - rect.top) / rect.height;
      caret = Math.max(0, Math.min(body.length, Math.round(ratio * body.length)));
    }
    caretRef.current = caret;
    setEdit({ index, draft: body, original: body, caret, base });
  }, []);

  const attach = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (!el) return;
    el.focus();
    const pos = Math.min(caretRef.current, el.value.length);
    el.setSelectionRange(pos, pos);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const view = edit ? edit.base : doc;

  return (
    <div className="viewer md-body">
      {view.chunks.map((chunk, i) => (
        edit && edit.index === i ? (
          <div className="md-edit" key={`e${i}`}>
            <textarea
              ref={attach}
              className="md-edit-area"
              value={edit.draft}
              spellCheck={false}
              autoComplete="off"
              onChange={(ev) => {
                const draft = ev.target.value;
                const el = ev.target;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
                setEdit((prev) => (prev ? { ...prev, draft } : prev));
                write(edit.base, edit.index, draft);
              }}
              onBlur={() => setEdit(null)}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  write(edit.base, edit.index, edit.original);
                  setEdit(null);
                  return;
                }
                if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
                  ev.preventDefault();
                  setEdit(null);
                }
              }}
            />
          </div>
        ) : (
          <RenderedBlock
            key={`b${i}`}
            body={chunk.body}
            path={path}
            index={i}
            onEnter={startEdit}
          />
        )
      ))}
    </div>
  );
}

const RenderedBlock = memo(function RenderedBlock({
  body,
  path,
  index,
  onEnter,
}: {
  body: string;
  path: string;
  index: number;
  onEnter: (index: number, clientY: number, rect: DOMRect) => void;
}) {
  const prepared = useMemo(() => expandPhysics(body), [body]);
  return (
    <div
      className="md-block"
      onClick={(ev) => {
        if (ev.detail !== 1) return;
        const target = ev.target as HTMLElement;
        if (target.closest('a, button, input, textarea, select')) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        onEnter(index, ev.clientY, ev.currentTarget.getBoundingClientRect());
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, {
          throwOnError: false,
          strict: false,
          macros: KATEX_MACROS,
        }]]}
        urlTransform={(href) => resolveMdUrl(href, path)}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
});

/** Split a document into top-level blocks, keeping every byte of the source. */
function splitChunks(src: string): Doc {
  if (!src) return { lead: '', chunks: [] };
  const lines = src.split('\n');
  const chunks: Chunk[] = [];
  let lead = '';
  let cur: string[] = [];
  let gap: string[] = [];
  let fence: string | null = null;
  let math = false;

  const close = (last: boolean) => {
    if (!cur.length) return;
    const body = cur.join('\n');
    const trail = gap.length ? `\n${gap.join('\n')}${last ? '' : '\n'}` : (last ? '' : '\n');
    chunks.push({ body, trail });
    cur = [];
    gap = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line);

    if (fence) {
      cur.push(line);
      if (fenceMark && trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMark) {
      if (gap.length) close(false);
      fence = fenceMark[1].slice(0, 3);
      cur.push(line);
      continue;
    }
    if (math) {
      cur.push(line);
      if (trimmed.endsWith('$')) math = false;
      continue;
    }
    if (trimmed.startsWith('$')) {
      if (gap.length) close(false);
      cur.push(line);
      if (!(trimmed.length > 2 && trimmed.endsWith('$'))) math = true;
      continue;
    }
    if (trimmed === '') {
      if (cur.length) gap.push(line);
      else if (!chunks.length) lead += `${line}\n`;
      continue;
    }
    if (gap.length) close(false);
    cur.push(line);
  }
  close(true);
  if (!chunks.length) return { lead: '', chunks: [{ body: src, trail: '' }] };
  return { lead, chunks };
}

function resolveMdUrl(href: string, filePath: string): string {
  if (!href) return href;
  if (/^(https?:|data:|mailto:|blob:|#)/i.test(href)) return href;
  if (href.startsWith('/api/')) return href;
  const abs = href.startsWith('/')
    ? href
    : joinPath(dirname(filePath), href);
  return `/api/fs/raw?path=${encodeURIComponent(abs)}`;
}

function joinPath(dir: string, rel: string): string {
  const base = dir === '/' ? '' : dir;
  const parts = `${base}/${rel}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}
