/** Prepare editor text for “run in terminal”, with Python REPL-safe wrapping. */

export function prepareRunText(raw: string, filePath: string | null | undefined): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.trim()) return '';
  if (!isPythonPath(filePath)) return text.endsWith('\n') ? text : `${text}\n`;
  return wrapPythonForRepl(dedentPython(text));
}

function isPythonPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const base = filePath.split('/').pop() || '';
  return /\.pyw?$/i.test(base);
}

/** Strip the common leading indent so a mid-function selection still runs. */
export function dedentPython(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (!lines.length) return '\n';

  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const m = line.match(/^[ \t]*/);
      const prefix = m?.[0] || '';
      return [...prefix].reduce((n, ch) => n + (ch === '\t' ? 4 : 1), 0);
    });
  const min = indents.length ? Math.min(...indents) : 0;
  if (min <= 0) return `${lines.join('\n')}\n`;

  const out = lines.map((line) => {
    if (!line.trim()) return '';
    let remain = min;
    let i = 0;
    while (i < line.length && remain > 0) {
      if (line[i] === ' ') {
        remain -= 1;
        i += 1;
      } else if (line[i] === '\t') {
        remain -= 4;
        i += 1;
      } else break;
    }
    return line.slice(i);
  });
  return `${out.join('\n')}\n`;
}

/**
 * Paste into a Python REPL as one exec(...) so if/else/for blocks are not
 * broken by blank lines or missing trailing blank lines (interactive "..." mode).
 */
export function wrapPythonForRepl(code: string): string {
  const body = code.endsWith('\n') ? code : `${code}\n`;
  const mode = useSingleMode(body) ? 'single' : 'exec';
  // JSON string literals are valid Python str literals for this use.
  return `exec(compile(${JSON.stringify(body)}, "<remotepad>", ${JSON.stringify(mode)}))\n`;
}

function useSingleMode(body: string): boolean {
  const trimmed = body.replace(/\s+$/u, '');
  if (!trimmed || trimmed.includes('\n')) return false;
  // Compound headers need exec even on one physical line (rare).
  if (/^\s*(async\s+)?(def|class|for|while|if|try|with)\b/.test(trimmed)) return false;
  return true;
}
