import fs from 'node:fs';
import path from 'node:path';
import type { DefinitionLocation } from '@remotepad/shared';

/**
 * Def/usage lookup for Python without a language server.
 *
 * Python has no type checker here, so this resolves what a reader actually
 * needs: the enclosing class for `self.x`, an imported module or name, a
 * parameter annotation, and — last resort — a workspace-wide `def`/`class`
 * scan. Every hit is a real file:line; nothing is synthesized.
 */

const MAX_FILE = 1.5 * 1024 * 1024;
const MAX_WALK = 4000;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'site-packages',
  '.mypy_cache', '.pytest_cache', '.tox', 'dist', 'build', '.eggs', '.worktrees', '.previews',
]);

export interface PyDef {
  name: string;
  line: number;
  column: number;
  indent: number;
  kind: 'function' | 'class' | 'variable' | 'module';
  preview: string;
}

interface CacheEntry { mtimeMs: number; defs: PyDef[]; lines: string[] }
const fileCache = new Map<string, CacheEntry>();

function read(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function load(file: string): CacheEntry | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
  const text = read(file);
  if (text === null) return null;
  const lines = text.split('\n');
  const entry: CacheEntry = { mtimeMs: stat.mtimeMs, defs: scanDefs(lines), lines };
  fileCache.set(file, entry);
  return entry;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += line[i] === '\t' ? 4 : 1;
  return i;
}

export function scanDefs(lines: string[]): PyDef[] {
  const defs: PyDef[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');
    const indent = indentOf(line);
    const body = line.slice(indent);
    const fn = /^(async\s+)?def\s+([A-Za-z_]\w*)/.exec(body);
    if (fn) {
      defs.push({
        name: fn[2], line: i + 1, column: indent + 1, indent,
        kind: 'function', preview: line.trim().slice(0, 160),
      });
      continue;
    }
    const cls = /^class\s+([A-Za-z_]\w*)/.exec(body);
    if (cls) {
      defs.push({
        name: cls[1], line: i + 1, column: indent + 1, indent,
        kind: 'class', preview: line.trim().slice(0, 160),
      });
      continue;
    }
    const assign = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/.exec(body);
    if (assign) {
      defs.push({
        name: assign[1], line: i + 1, column: indent + 1, indent,
        kind: 'variable', preview: line.trim().slice(0, 160),
      });
    }
  }
  return defs;
}

function wordAt(text: string, offset: number): { word: string; start: number } | null {
  const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  let start = offset;
  if (start >= text.length || !isWord(text[start])) start -= 1;
  if (start < 0 || !isWord(text[start])) return null;
  let end = start;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end + 1 < text.length && isWord(text[end + 1])) end += 1;
  return { word: text.slice(start, end + 1), start };
}

export function offsetAt(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
  return Math.min(offset + Math.max(column - 1, 0), text.length);
}

/** Nearest directory that looks like a project, else the file's own directory. */
export function projectRootForPy(file: string): string {
  let dir = path.dirname(file);
  let gitRoot = '';
  for (let i = 0; i < 64; i += 1) {
    for (const marker of ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'manage.py']) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    if (!gitRoot && fs.existsSync(path.join(dir, '.git'))) gitRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitRoot || path.dirname(file);
}

function moduleCandidates(fromFile: string, module: string, roots: string[]): string[] {
  const level = (module.match(/^\.+/) || [''])[0].length;
  const rest = module.slice(level);
  const out: string[] = [];
  const rel = rest ? rest.split('.').join('/') : '';
  if (level > 0) {
    let base = path.dirname(fromFile);
    for (let i = 1; i < level; i += 1) base = path.dirname(base);
    if (rel) {
      out.push(path.join(base, `${rel}.py`), path.join(base, rel, '__init__.py'));
    } else {
      out.push(path.join(base, '__init__.py'));
    }
  } else if (rel) {
    for (const root of roots) {
      out.push(path.join(root, `${rel}.py`), path.join(root, rel, '__init__.py'));
    }
  }
  return out.filter((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

interface ImportInfo {
  /** local name in this file */
  local: string;
  /** module dotted path, relative imports keep their dots */
  module: string;
  /** for `from x import y`, the imported attribute */
  name?: string;
}

function parseImports(lines: string[]): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    let from = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(line);
    if (from) {
      let spec = from[2];
      if (spec.includes('(') && !spec.includes(')')) {
        for (let j = i + 1; j < lines.length && j < i + 20; j += 1) {
          spec += ' ' + lines[j].trim();
          if (lines[j].includes(')')) break;
        }
      }
      spec = spec.replace(/[()]/g, ' ').replace(/#.*$/, '');
      for (const rawItem of spec.split(',')) {
        const item = rawItem.trim();
        if (!item) continue;
        const m = /^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(item);
        if (!m) continue;
        out.push({ local: m[2] || m[1], module: from[1], name: m[1] });
      }
      continue;
    }
    const plain = /^import\s+(.+)$/.exec(line);
    if (!plain) continue;
    for (const rawItem of plain[1].replace(/#.*$/, '').split(',')) {
      const item = rawItem.trim();
      if (!item) continue;
      const m = /^([.\w]+)(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(item);
      if (!m) continue;
      out.push({ local: m[2] || m[1].split('.')[0], module: m[1] });
    }
  }
  return out;
}

/** Line range of a class/def block, from its header to the first line that dedents. */
function blockEnd(lines: string[], startIndex: number): number {
  const indent = indentOf(lines[startIndex]);
  let end = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (indentOf(line) <= indent) {
      end = i;
      break;
    }
  }
  return end;
}

function enclosingBlock(lines: string[], lineNo: number): { kind: 'class' | 'function'; name: string; start: number; end: number } | null {
  let best: { kind: 'class' | 'function'; name: string; start: number; end: number } | null = null;
  for (let i = lineNo - 2; i >= 0; i -= 1) {
    const line = lines[i];
    const indent = indentOf(line);
    if (indent >= indentOf(lines[lineNo - 1] ?? '')) continue;
    const cls = /^\s*class\s+([A-Za-z_]\w*)/.exec(line);
    if (cls) {
      best = { kind: 'class', name: cls[1], start: i, end: blockEnd(lines, i) };
      break;
    }
    const fn = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      best = { kind: 'function', name: fn[1], start: i, end: blockEnd(lines, i) };
      break;
    }
  }
  return best;
}

/** Nearest enclosing class of a line, walking past the method that contains it. */
function enclosingClass(lines: string[], lineNo: number): string | null {
  const current = indentOf(lines[lineNo - 1] ?? '');
  for (let i = lineNo - 2; i >= 0; i -= 1) {
    if (indentOf(lines[i]) >= current) continue;
    const m = /^\s*class\s+([A-Za-z_]\w*)/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

function asLocation(file: string, def: PyDef, lines: string[]): DefinitionLocation {
  return {
    path: file,
    line: def.line,
    column: def.column,
    name: def.name,
    kind: def.kind,
    preview: (lines[def.line - 1] ?? def.preview).trim().slice(0, 160),
  };
}

function findInFile(file: string, name: string): PyDef[] {
  const entry = load(file);
  if (!entry) return [];
  return entry.defs.filter((def) => def.name === name);
}

interface WalkCache { at: number; root: string; files: string[] }
let walkCache: WalkCache | null = null;

function pyFiles(root: string): string[] {
  if (walkCache && walkCache.root === root && Date.now() - walkCache.at < 20_000) return walkCache.files;
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (files.length >= MAX_WALK || depth > 16) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_WALK) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(root, 0);
  walkCache = { at: Date.now(), root, files };
  return files;
}

function searchWorkspace(root: string, fromFile: string, name: string, defsOnly = true): DefinitionLocation[] {
  const hits: DefinitionLocation[] = [];
  const fromDir = path.dirname(fromFile);
  const files = pyFiles(root).slice().sort((a, b) => {
    const da = a.startsWith(fromDir) ? 0 : 1;
    const db = b.startsWith(fromDir) ? 0 : 1;
    if (da !== db) return da - db;
    return a.split('/').length - b.split('/').length;
  });
  for (const file of files) {
    if (file === fromFile) continue;
    const entry = load(file);
    if (!entry) continue;
    for (const def of entry.defs) {
      if (def.name !== name) continue;
      if (defsOnly && def.kind === 'variable' && def.indent > 0) continue;
      hits.push(asLocation(file, def, entry.lines));
      if (hits.length >= 5) return hits;
    }
  }
  return hits;
}

export interface PyLookup {
  locations: DefinitionLocation[];
  note?: string;
}

/** `obj.attr` → the object expression before the dot (single level). */
function attributeBase(lines: string[], lineIndex: number, wordStart: number): string | null {
  const line = lines[lineIndex] ?? '';
  let i = wordStart - 1;
  while (i >= 0 && /\s/.test(line[i])) i -= 1;
  if (i < 0 || line[i] !== '.') return null;
  i -= 1;
  while (i >= 0 && /\s/.test(line[i])) i -= 1;
  let end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_.]/.test(line[i])) i -= 1;
  const base = line.slice(i + 1, end);
  return base || null;
}

function classBodyDefs(lines: string[], className: string, name: string): PyDef[] {
  const out: PyDef[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*class\s+([A-Za-z_]\w*)/.exec(lines[i]);
    if (!m || m[1] !== className) continue;
    const end = blockEnd(lines, i);
    for (let j = i; j < end; j += 1) {
      const body = lines[j].trim();
      // `def name`, `name = …`, and instance attributes (`self.name = …`) all
      // declare the member a reader is looking for.
      const declares = new RegExp(`^(?:async\\s+)?def\\s+${name}\\b`).test(body)
        || new RegExp(`^${name}\\s*(?::[^=]*)?=(?!=)`).test(body)
        || new RegExp(`^self\\.${name}\\s*(?::[^=]*)?[+\\-*/|&]?=(?!=)`).test(body);
      if (!declares) continue;
      const isDef = body.startsWith('def') || body.startsWith('async');
      out.push({
        name,
        line: j + 1,
        column: indentOf(lines[j]) + 1,
        indent: indentOf(lines[j]),
        kind: isDef ? 'function' : 'variable',
        preview: body.slice(0, 160),
      });
    }
    return out;
  }
  return out;
}

/**
 * Where `name` is declared as a member of a class in this file.
 *
 * Only returned when a single class declares it — otherwise the guess would be
 * a coin flip. Within that class the first declaration wins (`__init__`'s
 * assignment), because later ones are writes, not the definition.
 */
function anyClassMember(lines: string[], name: string): PyDef[] {
  const owners = new Map<string, PyDef>();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*class\s+([A-Za-z_]\w*)/.exec(lines[i]);
    if (!m) continue;
    for (const def of classBodyDefs(lines, m[1], name)) {
      const existing = owners.get(m[1]);
      if (!existing || def.line < existing.line) owners.set(m[1], def);
    }
  }
  if (owners.size !== 1) return [];
  return [...owners.values()];
}

export function findPyDefinition(
  file: string,
  line: number,
  column: number,
  overrideText?: string,
): PyLookup {
  const entry = load(file);
  const lines = overrideText !== undefined ? overrideText.split('\n') : entry?.lines;
  if (!lines) return { locations: [], note: 'File is not readable' };
  const text = lines.join('\n');
  const hit = wordAt(text, offsetAt(text, line, column));
  if (!hit) return { locations: [], note: 'No symbol at the cursor' };
  const name = hit.word;
  const lineIndex = text.slice(0, hit.start).split('\n').length - 1;
  const wordColumn = hit.start - (text.lastIndexOf('\n', hit.start) + 1);
  const base = attributeBase(lines, lineIndex, wordColumn);

  const root = projectRootForPy(file);
  const imports = parseImports(lines);
  const roots = [root, path.dirname(file)];

  const push = (locations: DefinitionLocation[]) => locations;
  const sameFile = (entry?.defs ?? scanDefs(lines)).filter((def) => def.name === name);

  if (base) {
    const leaf = base.split('.').pop() || base;
    if (leaf === 'self' || leaf === 'cls') {
      const className = enclosingClass(lines, lineIndex + 1);
      if (className) {
        const defs = classBodyDefs(lines, className, name);
        if (defs.length) return { locations: push(defs.map((def) => asLocation(file, def, lines))) };
      }
    }
    // obj: ClassName / obj = ClassName(...)
    let typeName: string | null = null;
    for (let i = lineIndex; i >= 0 && i > lineIndex - 60; i -= 1) {
      const ann = new RegExp(`\\b${leaf}\\s*:\\s*([A-Za-z_]\\w*)`).exec(lines[i]);
      if (ann) {
        typeName = ann[1];
        break;
      }
      const assigned = new RegExp(`\\b${leaf}\\s*=\\s*([A-Za-z_]\\w*)\\s*\\(`).exec(lines[i]);
      if (assigned) {
        typeName = assigned[1];
        break;
      }
    }
    if (typeName) {
      const defs = classBodyDefs(lines, typeName, name);
      if (defs.length) return { locations: push(defs.map((def) => asLocation(file, def, lines))) };
    }
    // No annotation: if exactly one class in this file has the member, that is
    // the only reading the file supports.
    const members = anyClassMember(lines, name);
    if (members.length === 1) {
      return { locations: push(members.map((def) => asLocation(file, def, lines))) };
    }
    // imported module: mod.attr / pkg.mod.attr
    const imported = imports.find((item) => item.local === leaf && !item.name);
    if (imported) {
      for (const candidate of moduleCandidates(file, imported.module, roots)) {
        const defs = findInFile(candidate, name);
        const moduleLevel = defs.filter((def) => def.indent === 0);
        if (moduleLevel.length) {
          const entry2 = load(candidate)!;
          return { locations: push(moduleLevel.map((def) => asLocation(candidate, def, entry2.lines))) };
        }
      }
    }
  } else {
    // local definition first, then an imported one
    if (sameFile.length) {
      const ordered = sameFile.slice().sort((a, b) => a.indent - b.indent || a.line - b.line);
      return { locations: ordered.slice(0, 5).map((def) => asLocation(file, def, lines)) };
    }
    const imported = imports.find((item) => item.local === name && item.name);
    if (imported) {
      for (const candidate of moduleCandidates(file, imported.module, roots)) {
        const defs = findInFile(candidate, imported.name || name);
        if (defs.length) {
          const entry2 = load(candidate)!;
          return {
            locations: defs.filter((def) => def.indent === 0).slice(0, 5)
              .map((def) => asLocation(candidate, def, entry2.lines)),
          };
        }
      }
    }
    const asModule = imports.find((item) => item.local === name && !item.name);
    if (asModule) {
      for (const candidate of moduleCandidates(file, asModule.module, roots)) {
        const entry2 = load(candidate);
        if (!entry2) continue;
        return {
          locations: [{
            path: candidate,
            line: 1,
            column: 1,
            name,
            kind: 'module',
            preview: candidate.replace(root + '/', ''),
          }],
        };
      }
    }
  }

  const workspace = searchWorkspace(root, file, name);
  if (workspace.length) return { locations: workspace };
  return { locations: [], note: `No definition found for "${name}" in ${root}` };
}
