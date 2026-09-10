const CMDS = ['pdv', 'dv', 'fdv'] as const;

function readGroup(src: string, start: number): { inner: string; end: number } | null {
  if (src[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { inner: src.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function parseCmd(src: string, name: string, from: number) {
  const token = `\\${name}`;
  if (!src.startsWith(token, from)) return null;
  let i = from + token.length;
  if (/[A-Za-z]/.test(src[i] || '')) return null;
  if (src[i] === '*') i += 1;
  let opt: string | undefined;
  if (src[i] === '[') {
    const close = src.indexOf(']', i);
    if (close < 0) return null;
    opt = src.slice(i + 1, close);
    i = close + 1;
  }
  const args: string[] = [];
  while (src[i] === '{' && args.length < 3) {
    const group = readGroup(src, i);
    if (!group) break;
    args.push(group.inner);
    i = group.end;
  }
  if (!args.length) return null;
  return { end: i, opt, args };
}

function wrapPow(n?: string): string {
  return n && n !== '1' ? `^{${n}}` : '';
}

function expandOne(name: string, opt: string | undefined, args: string[]): string {
  const n = opt?.trim();
  const pow = wrapPow(n);
  const d = name === 'fdv' ? '\\delta' : name === 'dv' ? '\\mathrm{d}' : '\\partial';
  const a = args.map((item) => expandPhysics(item));
  if (a.length === 1) return `\\frac{${d}${pow}}{${d} ${a[0]}${pow}}`;
  if (a.length === 2) return `\\frac{${d}${pow} ${a[0]}}{${d} ${a[1]}${pow}}`;
  const order = n && n !== '1' ? n : '2';
  return `\\frac{${d}^{${order}} ${a[0]}}{${d} ${a[1]} ${d} ${a[2]}}`;
}

export function expandPhysics(src: string): string {
  let out = src
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}');
  let i = 0;
  let result = '';
  while (i < out.length) {
    if (out[i] !== '\\') {
      result += out[i];
      i += 1;
      continue;
    }
    let matched = false;
    for (const name of CMDS) {
      const parsed = parseCmd(out, name, i);
      if (!parsed) continue;
      result += expandOne(name, parsed.opt, parsed.args);
      i = parsed.end;
      matched = true;
      break;
    }
    if (!matched) {
      result += out[i];
      i += 1;
    }
  }
  return result;
}

export const KATEX_MACROS: Record<string, string> = {
  '\\div': '\\nabla\\cdot',
  '\\curl': '\\nabla\\times',
  '\\grad': '\\nabla',
  '\\laplacian': '\\nabla^{2}',
  '\\oiint': '\\oint',
  '\\oiiint': '\\oint',
};
