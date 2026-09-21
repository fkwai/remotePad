import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Favorite } from '@remotepad/shared';
import { PathError, resolveSafe } from './paths.ts';

const FILE = path.join(os.homedir(), '.remotepad', 'favorites.json');

interface Store {
  seeded?: boolean;
  folders: Favorite[];
}

async function readStore(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8')) as Store;
    const folders = Array.isArray(raw.folders)
      ? raw.folders.filter((item) => item && typeof item.path === 'string' && typeof item.name === 'string')
      : [];
    return { seeded: Boolean(raw.seeded), folders };
  } catch {
    return { seeded: false, folders: [] };
  }
}

async function writeStore(store: Store) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ seeded: true, folders: store.folders }, null, 2));
}

function asFavorite(target: string): Favorite {
  return { path: target, name: path.basename(target) || target };
}

export async function listFavorites(): Promise<Favorite[]> {
  const store = await readStore();
  if (store.seeded) return store.folders;
  const home = os.homedir();
  const folders = [{ path: home, name: path.basename(home) || 'home' }];
  await writeStore({ seeded: true, folders });
  return folders;
}

export async function pinFavorite(input: string): Promise<Favorite[]> {
  const target = resolveSafe(input);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new PathError('Path not found', 404);
  }
  if (!stat.isDirectory()) throw new PathError('Only folders can be pinned');
  const folders = await listFavorites();
  if (folders.some((item) => item.path === target)) return folders;
  folders.push(asFavorite(target));
  await writeStore({ seeded: true, folders });
  return folders;
}

export async function unpinFavorite(input: string): Promise<Favorite[]> {
  const target = path.resolve(input);
  const folders = (await listFavorites()).filter((item) => item.path !== target);
  await writeStore({ seeded: true, folders });
  return folders;
}

export async function reorderFavorites(paths: string[]): Promise<Favorite[]> {
  const folders = await listFavorites();
  const byPath = new Map(folders.map((item) => [item.path, item]));
  const next: Favorite[] = [];
  for (const raw of paths) {
    const key = path.resolve(raw);
    const item = byPath.get(key);
    if (!item) continue;
    next.push(item);
    byPath.delete(key);
  }
  next.push(...byPath.values());
  await writeStore({ seeded: true, folders: next });
  return next;
}
