import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type { AgentChange, AgentChangeKind } from '@remotepad/shared';
import { config } from '../config.ts';

const execFileAsync = promisify(execFile);

type Snap = {
  missing: boolean;
  binary: boolean;
  text: string | null;
  buf: Buffer | null;
};

type Entry = {
  original: Snap;
  current: Snap;
  diff: string;
};

export class ChangeTracker {
  private entries = new Map<string, Entry>();
  private gitBaseline = new Map<string, Snap>();
  private gitRepo: string | null = null;

  list(): AgentChange[] {
    this.dropIgnored();
    return [...this.entries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, entry]) => ({
        path: filePath,
        kind: kindOf(entry),
        binary: entry.original.binary || entry.current.binary,
        diff: entry.diff,
      }));
  }

  async snapshotBeforeWrite(filePath: string): Promise<void> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs) || this.entries.has(abs)) return;
    const original = await readSnap(abs);
    this.entries.set(abs, { original, current: original, diff: '' });
  }

  async refresh(filePath: string): Promise<boolean> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs)) {
      const existed = this.entries.delete(abs);
      return existed;
    }
    const existing = this.entries.get(abs);
    const original = existing?.original ?? await readSnap(abs);
    const current = await readSnap(abs);
    if (snapsEqual(original, current)) {
      this.entries.delete(abs);
      return Boolean(existing);
    }
    const binary = original.binary || current.binary;
    const kind = kindOf({ original, current });
    const diff = binary
      ? `Binary file ${kind}\n`
      : await unifiedDiff(abs, original.missing ? null : original.text, current.missing ? null : current.text);
    this.entries.set(abs, { original, current, diff });
    return true;
  }

  async captureGitBaseline(cwd: string): Promise<void> {
    this.gitBaseline.clear();
    this.gitRepo = await findRepoRoot(cwd);
    if (!this.gitRepo) return;
    try {
      const git = simpleGit(this.gitRepo);
      const status = await git.status();
      const ignored = await gitIgnoredRels(this.gitRepo, status.files.map((file) => file.path));
      for (const file of status.files) {
        if (ignored.has(file.path)) continue;
        const abs = path.join(this.gitRepo, file.path);
        if (isRuntimePath(abs)) continue;
        this.gitBaseline.set(abs, await readSnap(abs));
      }
    } catch {
      this.gitRepo = null;
      this.gitBaseline.clear();
    }
  }

  async harvestGitExtras(cwd: string): Promise<string[]> {
    const repo = this.gitRepo || await findRepoRoot(cwd);
    if (!repo) return [];
    const touched: string[] = [];
    try {
      const git = simpleGit(repo);
      const status = await git.status();
      const ignored = await gitIgnoredRels(repo, status.files.map((file) => file.path));
      const seen = new Set<string>();
      for (const file of status.files) {
        if (ignored.has(file.path)) continue;
        const abs = path.join(repo, file.path);
        if (isRuntimePath(abs)) continue;
        seen.add(abs);
        if (this.entries.has(abs)) {
          if (await this.refresh(abs)) touched.push(abs);
          continue;
        }
        const current = await readSnap(abs);
        let original = this.gitBaseline.get(abs);
        if (!original) original = await readHeadSnap(git, file.path, current);
        if (snapsEqual(original, current)) continue;
        this.entries.set(abs, { original, current, diff: '' });
        if (await this.refresh(abs)) touched.push(abs);
      }
      for (const [abs, original] of this.gitBaseline) {
        if (seen.has(abs) || this.entries.has(abs)) continue;
        const current = await readSnap(abs);
        if (snapsEqual(original, current)) continue;
        this.entries.set(abs, { original, current, diff: '' });
        if (await this.refresh(abs)) touched.push(abs);
      }
    } catch {
      // ignore git harvest failures
    }
    return [...new Set(touched)];
  }

  async accept(filePath: string): Promise<string[]> {
    const abs = path.resolve(filePath);
    this.entries.delete(abs);
    return [abs];
  }

  async undo(filePath: string): Promise<string[]> {
    const abs = path.resolve(filePath);
    if (isRuntimePath(abs)) {
      this.entries.delete(abs);
      return [];
    }
    const entry = this.entries.get(abs);
    if (!entry) return [];
    await restoreSnap(abs, entry.original);
    this.entries.delete(abs);
    return [abs];
  }

  async acceptAll(): Promise<string[]> {
    this.dropIgnored();
    const paths = [...this.entries.keys()];
    this.entries.clear();
    return paths;
  }

  async undoAll(): Promise<string[]> {
    this.dropIgnored();
    const paths = [...this.entries.keys()];
    for (const filePath of paths) {
      const entry = this.entries.get(filePath);
      if (entry) await restoreSnap(filePath, entry.original);
    }
    this.entries.clear();
    return paths;
  }

  private dropIgnored(): void {
    for (const abs of this.entries.keys()) {
      if (isRuntimePath(abs)) this.entries.delete(abs);
    }
  }
}

function isInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function gitIgnoredRels(repo: string, rels: string[]): Promise<Set<string>> {
  const ignored = new Set<string>();
  const unique = [...new Set(rels.filter(Boolean))];
  if (unique.length === 0) return ignored;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repo, 'check-ignore', '--no-index', '-z', '--', ...unique], {
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const item of stdout.split('\0')) if (item) ignored.add(item);
  } catch (err) {
    const execErr = err as { code?: number; stdout?: string };
    if (typeof execErr.stdout === 'string') {
      for (const item of execErr.stdout.split('\0')) if (item) ignored.add(item);
    }
  }
  return ignored;
}

function isRuntimePath(filePath: string): boolean {
  const abs = path.resolve(filePath);
  const roots = [
    path.resolve(config.xiaobaDataDir),
    path.join(os.homedir(), '.remotepad'),
    path.join(os.homedir(), '.xiaoba'),
  ];
  if (roots.some((root) => isInside(root, abs))) return true;
  const base = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  const grand = path.basename(path.dirname(path.dirname(abs)));
  if (parent === 'pet' && grand === 'data') return true;
  if (grand === 'data' && parent === 'sessions' && /^(rp-[a-z0-9]+|cli|remotepad)\.jsonl$/i.test(base)) return true;
  if (grand === 'data' && parent === 'session-state' && /^(rp-[a-z0-9]+|cli|remotepad)\.json$/i.test(base)) return true;
  return false;
}

async function findRepoRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    try {
      const gitDir = path.join(current, '.git');
      const stat = await fs.lstat(gitDir);
      if (stat.isDirectory() || stat.isFile()) return current;
    } catch {
      // continue
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readSnap(filePath: string): Promise<Snap> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) return { missing: true, binary: false, text: null, buf: null };
    if (stat.size > config.textSizeLimit) {
      return { missing: false, binary: true, text: null, buf: null };
    }
    const buf = await fs.readFile(filePath);
    if (buf.includes(0)) return { missing: false, binary: true, text: null, buf };
    return { missing: false, binary: false, text: buf.toString('utf8'), buf };
  } catch {
    return { missing: true, binary: false, text: null, buf: null };
  }
}

async function readHeadSnap(
  git: ReturnType<typeof simpleGit>,
  rel: string,
  current: Snap,
): Promise<Snap> {
  try {
    const text = await git.show([`HEAD:${rel}`]);
    return { missing: false, binary: false, text, buf: Buffer.from(text) };
  } catch {
    if (current.missing) return current;
    return { missing: true, binary: false, text: null, buf: null };
  }
}

async function restoreSnap(filePath: string, snap: Snap): Promise<void> {
  if (snap.missing) {
    try { await fs.unlink(filePath); } catch { /* already gone */ }
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (snap.buf) await fs.writeFile(filePath, snap.buf);
  else await fs.writeFile(filePath, snap.text ?? '');
}

function snapsEqual(a: Snap, b: Snap): boolean {
  if (a.missing && b.missing) return true;
  if (a.missing !== b.missing) return false;
  if (a.binary || b.binary) {
    if (!a.buf || !b.buf) return false;
    return a.buf.equals(b.buf);
  }
  return a.text === b.text;
}

function kindOf(entry: Pick<Entry, 'original' | 'current'>): AgentChangeKind {
  if (entry.original.missing && !entry.current.missing) return 'create';
  if (!entry.original.missing && entry.current.missing) return 'delete';
  return 'modify';
}

async function unifiedDiff(filePath: string, before: string | null, after: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmpad-diff-'));
  try {
    const left = path.join(dir, 'a');
    const right = path.join(dir, 'b');
    await fs.writeFile(left, before ?? '');
    await fs.writeFile(right, after ?? '');
    try {
      const { stdout } = await execFileAsync('diff', [
        '-u',
        '--label', `a/${filePath}`,
        '--label', `b/${filePath}`,
        left,
        right,
      ], { maxBuffer: 4 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string };
      if (typeof execErr.stdout === 'string' && execErr.stdout) return execErr.stdout;
      return fallbackDiff(filePath, before ?? '', after ?? '');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function fallbackDiff(filePath: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.map((line) => `-${line}`),
    ...b.map((line) => `+${line}`),
  ].join('\n') + '\n';
}
