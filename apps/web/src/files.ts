export type ViewerKind = 'markdown' | 'json' | 'jsonl' | 'csv' | 'image' | 'html' | 'log' | 'code' | 'diff' | 'folder';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

export function extOf(filePath: string): string {
  const base = filePath.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function viewerKind(filePath: string): ViewerKind {
  const ext = extOf(filePath);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (IMAGE.has(ext)) return 'image';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'log' || ext === 'txt') return 'log';
  return 'code';
}

export function hasRenderedView(kind: ViewerKind): boolean {
  return kind !== 'code' && kind !== 'diff' && kind !== 'folder';
}

export function monacoLanguage(filePath: string): string {
  const ext = extOf(filePath);
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonl: 'json',
    ndjson: 'json',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    java: 'java',
    kt: 'kotlin',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
    csv: 'plaintext',
    tsv: 'plaintext',
    log: 'plaintext',
    txt: 'plaintext',
    ini: 'ini',
    conf: 'ini',
    dockerfile: 'dockerfile',
  };
  const base = filePath.split('/').pop()?.toLowerCase() || '';
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  return map[ext] || 'plaintext';
}

export function fileMark(filePath: string): { text: string; cls: string } {
  const ext = extOf(filePath);
  if (ext === 'py') return { text: 'py', cls: 'mk-py' };
  if (ext === 'ts' || ext === 'tsx') return { text: 'ts', cls: 'mk-ts' };
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return { text: 'js', cls: 'mk-js' };
  if (ext === 'md' || ext === 'markdown') return { text: 'md', cls: 'mk-md' };
  if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') return { text: '{}', cls: 'mk-json' };
  return { text: '▤', cls: 'mk-file' };
}

export function basename(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() || filePath;
}

export function dirname(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (filePath.startsWith('/')) return '/' + parts.slice(0, -1).join('/');
  return parts.slice(0, -1).join('/');
}
