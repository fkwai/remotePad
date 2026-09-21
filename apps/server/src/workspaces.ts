import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Repo } from '@remotepad/shared';
import { PathError, resolveSafe } from './paths.ts';
import { findRepoRoot, readRepoHead } from './git.ts';

export const CONTROL_PATH = path.join(os.homedir(), '.remotepad', 'workspaces.json');

interface Stored {
  path: string;
  name: string;
  startup?: string[];
}

interface Store {
  folders: Stored[];
}

function asLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function asStored(raw: unknown): { item: Stored; migrated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.path !== 'string' || typeof rec.name !== 'string') return null;
  let startup = asLines(rec.startup);
  let migrated = false;
  if (startup.length === 0) {
    const activate = typeof rec.activate === 'string' ? rec.activate.trim() : '';
    const python = typeof rec.python === 'string' ? rec.python.trim() : '';
    if (activate) startup.push(`source ${activate}`);
    if (python) startup.push(python);
    migrated = startup.length > 0;
  }
  const item: Stored = { path: rec.path, name: rec.name };
  if (startup.length) item.startup = startup;
  if ('seeded' in rec || 'activate' in rec || 'python' in rec) migrated = true;
  return { item, migrated };
}

async function readStore(): Promise<{ store: Store; migrated: boolean }> {
  try {
    const raw = JSON.parse(await fs.readFile(CONTROL_PATH, 'utf8')) as Record<string, unknown>;
    const list = Array.isArray(raw.folders) ? raw.folders : [];
    const folders: Stored[] = [];
    let migrated = 'seeded' in raw;
    for (const item of list) {
      const parsed = asStored(item);
      if (!parsed) continue;
      folders.push(parsed.item);
      if (parsed.migrated) migrated = true;
    }
    return { store: { folders }, migrated };
  } catch {
    return { store: { folders: [] }, migrated: false };
  }
}

async function writeStore(store: Store) {
  await fs.mkdir(path.dirname(CONTROL_PATH), { recursive: true });
  await fs.writeFile(CONTROL_PATH, JSON.stringify({ folders: store.folders }, null, 2));
}

async function withHeads(folders: Stored[]): Promise<Repo[]> {
  return Promise.all(folders.map((item) => readRepoHead(item.path, item.name, item.startup)));
}

export async function listRepos(): Promise<Repo[]> {
  const { store, migrated } = await readStore();
  if (migrated) await writeStore(store);
  return withHeads(store.folders);
}

export async function pinRepo(input: string): Promise<Repo[]> {
  const target = resolveSafe(input);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new PathError('Path not found', 404);
  }
  if (!stat.isDirectory()) throw new PathError('Only folders can be added as a repo');
  const root = await findRepoRoot(target);
  if (!root) throw new PathError('Only Git repositories can be added as a repo');
  const { store } = await readStore();
  if (store.folders.some((item) => item.path === root)) return withHeads(store.folders);
  store.folders.push({ path: root, name: path.basename(root) || root });
  await writeStore(store);
  return withHeads(store.folders);
}

export async function unpinRepo(input: string): Promise<Repo[]> {
  const target = path.resolve(input);
  const { store } = await readStore();
  store.folders = store.folders.filter((item) => item.path !== target);
  await writeStore(store);
  return withHeads(store.folders);
}

export async function reorderRepos(paths: string[]): Promise<Repo[]> {
  const { store } = await readStore();
  const byPath = new Map(store.folders.map((item) => [item.path, item]));
  const next: Stored[] = [];
  for (const raw of paths) {
    const key = path.resolve(raw);
    const item = byPath.get(key);
    if (!item) continue;
    next.push(item);
    byPath.delete(key);
  }
  next.push(...byPath.values());
  store.folders = next;
  await writeStore(store);
  return withHeads(store.folders);
}
