import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '@remotepad/shared';
import { PathError, resolveSafe } from './paths.ts';

export const CONTROL_PATH = path.join(os.homedir(), '.remotepad', 'workspaces.json');

interface Store {
  folders: Workspace[];
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

function asWorkspace(raw: unknown): { ws: Workspace; migrated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.path !== 'string' || typeof item.name !== 'string') return null;
  let startup = asLines(item.startup);
  let migrated = false;
  if (startup.length === 0) {
    const activate = typeof item.activate === 'string' ? item.activate.trim() : '';
    const python = typeof item.python === 'string' ? item.python.trim() : '';
    if (activate) startup.push(`source ${activate}`);
    if (python) startup.push(python);
    migrated = startup.length > 0;
  }
  const ws: Workspace = { path: item.path, name: item.name };
  if (startup.length) ws.startup = startup;
  if ('seeded' in item || 'activate' in item || 'python' in item) migrated = true;
  return { ws, migrated };
}

async function readStore(): Promise<{ store: Store; migrated: boolean }> {
  try {
    const raw = JSON.parse(await fs.readFile(CONTROL_PATH, 'utf8')) as Record<string, unknown>;
    const list = Array.isArray(raw.folders) ? raw.folders : [];
    const folders: Workspace[] = [];
    let migrated = 'seeded' in raw;
    for (const item of list) {
      const parsed = asWorkspace(item);
      if (!parsed) continue;
      folders.push(parsed.ws);
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

export async function listWorkspaces(): Promise<Workspace[]> {
  const { store, migrated } = await readStore();
  if (migrated) await writeStore(store);
  return store.folders;
}

export async function pinWorkspace(input: string): Promise<Workspace[]> {
  const target = resolveSafe(input);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new PathError('Path not found', 404);
  }
  if (!stat.isDirectory()) throw new PathError('Only folders can be added to a workspace');
  const folders = await listWorkspaces();
  if (folders.some((item) => item.path === target)) return folders;
  folders.push({ path: target, name: path.basename(target) || target });
  await writeStore({ folders });
  return folders;
}

export async function unpinWorkspace(input: string): Promise<Workspace[]> {
  const target = path.resolve(input);
  const folders = (await listWorkspaces()).filter((item) => item.path !== target);
  await writeStore({ folders });
  return folders;
}
