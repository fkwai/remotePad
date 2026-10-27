import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { DefinitionLocation } from '@remotepad/shared';

/**
 * Def/usage lookup for JS/TS through the TypeScript language service.
 *
 * The editor already knows the file and the cursor; the server owns the project
 * view (tsconfig, imports, cross-file symbols). One service per project root,
 * cached for the lifetime of the process: programs are re-checked lazily by
 * version, so a file saved on disk is picked up on the next query.
 */

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
  '.cache', '.turbo', '.worktrees', '.previews', 'tmp', '.remotepad-preview',
]);
const MAX_FILES = 6000;
const MAX_TEXT = 2 * 1024 * 1024;

interface Project {
  root: string;
  files: string[];
  options: ts.CompilerOptions;
  host: Host;
  service: ts.LanguageService;
  scannedAt: number;
}

const projects = new Map<string, Project>();

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_TEXT) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function offsetAt(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
  return Math.min(offset + Math.max(column - 1, 0), text.length);
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i + 1;
    }
  }
  return { line, column: offset - last + 1 };
}

/** Nearest tsconfig/jsconfig, else the enclosing git repo (or the file's dir). */
export function projectRootFor(file: string): string {
  let dir = path.dirname(file);
  let gitRoot = '';
  for (let i = 0; i < 64; i += 1) {
    if (fs.existsSync(path.join(dir, 'tsconfig.json')) || fs.existsSync(path.join(dir, 'jsconfig.json'))) {
      return dir;
    }
    if (!gitRoot && fs.existsSync(path.join(dir, '.git'))) gitRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitRoot || path.dirname(file);
}

function walk(dir: string, out: string[], depth = 0): void {
  if (out.length >= MAX_FILES || depth > 24) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(full, out, depth + 1);
    } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name))) {
      try {
        if (fs.statSync(full).size <= MAX_TEXT) out.push(full);
      } catch {
        // vanished between readdir and stat
      }
    }
  }
}

class Host implements ts.LanguageServiceHost {
  private overrides = new Map<string, string>();
  private bump = new Map<string, number>();
  private snapshots = new Map<string, { key: string; snapshot: ts.IScriptSnapshot }>();

  constructor(
    private files: string[],
    private options: ts.CompilerOptions,
    private root: string,
    private defaultLib: string,
  ) {}

  setOverride(file: string, text: string): void {
    this.overrides.set(file, text);
    this.bump.set(file, (this.bump.get(file) ?? 0) + 1);
  }

  clearOverride(file: string): void {
    if (!this.overrides.delete(file)) return;
    this.bump.set(file, (this.bump.get(file) ?? 0) + 1);
  }

  getText(file: string): string | null {
    return this.overrides.get(file) ?? readText(file);
  }

  getScriptFileNames(): string[] {
    const all = new Set(this.files);
    for (const file of this.overrides.keys()) all.add(file);
    return [...all];
  }

  getScriptVersion(file: string): string {
    const bumped = this.bump.get(file) ?? 0;
    if (this.overrides.has(file)) return `o${bumped}`;
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}:${bumped}`;
    } catch {
      return `missing:${bumped}`;
    }
  }

  getScriptSnapshot(file: string): ts.IScriptSnapshot | undefined {
    const key = this.getScriptVersion(file);
    const cached = this.snapshots.get(file);
    if (cached && cached.key === key) return cached.snapshot;
    const text = this.getText(file);
    if (text === null) return undefined;
    const snapshot = ts.ScriptSnapshot.fromString(text);
    this.snapshots.set(file, { key, snapshot });
    return snapshot;
  }

  getCurrentDirectory(): string {
    return this.root;
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.options;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return this.defaultLib || ts.getDefaultLibFilePath(options);
  }

  fileExists(file: string): boolean {
    return fs.existsSync(file);
  }

  readFile(file: string): string | undefined {
    return readText(file) ?? undefined;
  }

  readDirectory(
    dir: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[] {
    return ts.sys.readDirectory(dir, extensions, exclude, include, depth);
  }

  directoryExists(dir: string): boolean {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }

  getDirectories(dir: string): string[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}

function defaultOptions(root: string): ts.CompilerOptions {
  return {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    forceConsistentCasingInFileNames: true,
    baseUrl: root,
  };
}

function scanFiles(root: string): { files: string[]; options: ts.CompilerOptions } {
  const configPath = ['tsconfig.json', 'jsconfig.json']
    .map((name) => path.join(root, name))
    .find((file) => fs.existsSync(file));
  if (configPath) {
    try {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!read.error) {
        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
        const files = parsed.fileNames.filter((file) => SOURCE_EXT.has(path.extname(file).toLowerCase()));
        if (files.length) {
          return {
            files: files.slice(0, MAX_FILES),
            options: { ...parsed.options, noEmit: true, skipLibCheck: true, allowJs: true },
          };
        }
      }
    } catch {
      // fall through to a plain scan
    }
  }
  const files: string[] = [];
  walk(root, files);
  return { files, options: defaultOptions(root) };
}

function projectFor(file: string): Project {
  const root = projectRootFor(file);
  let project = projects.get(root);
  const stale = project ? Date.now() - project.scannedAt > 15_000 : true;
  if (!project) {
    const { files, options } = scanFiles(root);
    const host = new Host(files, options, root, ts.getDefaultLibFilePath(options));
    project = {
      root,
      files,
      options,
      host,
      service: ts.createLanguageService(host, ts.createDocumentRegistry()),
      scannedAt: Date.now(),
    };
    projects.set(root, project);
  } else if (stale) {
    const { files, options } = scanFiles(root);
    project.files = files;
    project.host = new Host(files, options, root, ts.getDefaultLibFilePath(options));
    project.service = ts.createLanguageService(project.host, ts.createDocumentRegistry());
    project.options = options;
    project.scannedAt = Date.now();
  }
  if (!project.files.includes(file) && SOURCE_EXT.has(path.extname(file))) {
    project.files.push(file);
  }
  return project;
}

function wordAt(text: string, offset: number): { word: string; start: number } | null {
  const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  let start = offset;
  if (start >= text.length || !isWord(text[start])) start -= 1;
  if (start < 0 || !isWord(text[start])) return null;
  let end = start;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end + 1 < text.length && isWord(text[end + 1])) end += 1;
  return { word: text.slice(start, end + 1), start };
}

/**
 * Plain-file fallback: a file outside any project still has a declaration for
 * the identifier under the cursor. Ordered by proximity so "const foo" wins
 * over an unrelated mention.
 */
function fallbackInFile(file: string, text: string, offset: number): DefinitionLocation[] {
  const hit = wordAt(text, offset);
  if (!hit) return [];
  const escaped = hit.word.replace(/[$]/g, '\\$&');
  const patterns = [
    new RegExp(`\\b(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`\\bclass\\s+${escaped}\\b`),
    new RegExp(`\\b(?:interface|type|enum|namespace)\\s+${escaped}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(`^\\s*${escaped}\\s*[=:]`, 'm'),
  ];
  const lines = text.split('\n');
  const out: DefinitionLocation[] = [];
  for (const pattern of patterns) {
    for (let i = 0; i < lines.length && out.length < 3; i += 1) {
      if (!pattern.test(lines[i])) continue;
      const column = Math.max(lines[i].indexOf(hit.word), 0) + 1;
      out.push({
        path: file,
        line: i + 1,
        column,
        name: hit.word,
        kind: 'declaration',
        preview: lines[i].trim().slice(0, 160),
      });
    }
    if (out.length) break;
  }
  return out;
}

export interface TsLookup {
  locations: DefinitionLocation[];
  note?: string;
}

export function findTsDefinition(
  file: string,
  line: number,
  column: number,
  overrideText?: string,
): TsLookup {
  const text = overrideText ?? readText(file);
  if (!text) return { locations: [], note: 'File is not readable' };
  const offset = offsetAt(text, line, column);
  let project: Project;
  try {
    project = projectFor(file);
  } catch (err) {
    return { locations: [], note: `Cannot open project: ${err instanceof Error ? err.message : String(err)}` };
  }

  let definitions: readonly ts.DefinitionInfo[] = [];
  try {
    if (overrideText !== undefined) project.host.setOverride(file, overrideText);
    definitions = project.service.getDefinitionAtPosition(file, offset) ?? [];
  } catch (err) {
    return { locations: [], note: `Language service: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (overrideText !== undefined) project.host.clearOverride(file);
  }

  const locations: DefinitionLocation[] = [];
  for (const def of definitions) {
    const targetFile = path.resolve(def.fileName);
    const targetText = targetFile === file ? text : (project.host.getText(targetFile) ?? readText(targetFile));
    if (!targetText) continue;
    const pos = positionAt(targetText, def.textSpan.start);
    const lineText = targetText.split('\n')[pos.line - 1] ?? '';
    locations.push({
      path: targetFile,
      line: pos.line,
      column: pos.column,
      name: def.name || wordAt(text, offset)?.word,
      kind: String(def.kind || 'symbol'),
      preview: lineText.trim().slice(0, 160),
      external: targetFile.includes('/node_modules/') || targetFile.includes('/site-packages/'),
    });
    if (locations.length >= 8) break;
  }

  if (!locations.length) {
    const fallback = fallbackInFile(file, text, offset);
    if (fallback.length) return { locations: fallback };
    return { locations: [], note: 'No definition found for the symbol under the cursor' };
  }
  return { locations };
}
