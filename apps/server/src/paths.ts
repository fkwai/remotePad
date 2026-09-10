import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';

export class PathError extends Error {
  statusCode = 400;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function uniqueRoots(): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const root of config.roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots.filter((root, i, all) => !all.some((other, j) => i !== j && isInside(root, other)));
}

export function resolveSafe(input: string): string {
  if (!input) throw new PathError('Path is required');
  const resolved = path.resolve(input);
  const allowed = uniqueRoots().some((root) => isInside(resolved, root));
  if (!allowed) {
    throw new PathError('Path is outside allowed roots', 403);
  }
  return resolved;
}

export function isInside(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}
