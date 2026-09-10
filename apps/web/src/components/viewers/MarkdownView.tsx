import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { expandPhysics, KATEX_MACROS } from '../../typoraMath';
import { dirname } from '../../files';
import 'katex/dist/katex.min.css';

export function MarkdownView({ content, path }: { content: string; path: string }) {
  const prepared = expandPhysics(content);
  return (
    <div className="viewer md-body">
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
