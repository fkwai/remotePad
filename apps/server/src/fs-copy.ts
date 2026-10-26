import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

/**
 * Naming for a pasted copy.
 *
 * Copying `notes.md` next to itself must not overwrite the original, so the
 * first copy is `notes copy.md`, then `notes copy 2.md`. The extension stays at
 * the end — `notes copy.md` opens as markdown, `notes.md copy` does not.
 */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = `${stem} copy${ext}`;
  for (let i = 2; taken.has(candidate); i += 1) candidate = `${stem} copy ${i}${ext}`;
  return candidate;
}

export interface CopyRequest {
  from: string;
  /** Destination folder (the copied item keeps its name, made unique). */
  into: string;
  /** Force the destination name instead of the generated one. */
  as?: string;
}

export interface CopyResult {
  from: string;
  to: string;
}

/**
 * Copy a file or a whole folder into a destination folder.
 *
 * Refuses a folder copied into itself (or its own subtree), which would recurse
 * until the disk filled.
 */
export async function copyInto({ from, into, as }: CopyRequest): Promise<CopyResult> {
  const source = path.resolve(from);
  const destDir = path.resolve(into);

  const stat = await fs.lstat(source);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error('Only files and folders can be copied');
  }

  const destStat = await fs.stat(destDir).catch(() => null);
  if (!destStat?.isDirectory()) throw new Error('Destination is not a folder');

  if (stat.isDirectory()) {
    const rel = path.relative(source, destDir);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error('A folder cannot be copied into itself');
    }
  }

  const requested = as?.trim();
  let name = requested || '';
  if (!name) {
    // A different folder keeps the original name; only a name that is already
    // there gets " copy" appended.
    const base = path.basename(source);
    const taken = new Set(await fs.readdir(destDir));
    name = taken.has(base) ? copyName(base, taken) : base;
  }

  const target = path.join(destDir, name);
  if (stat.isDirectory()) {
    // errorOnExist + force:false keeps a paste from merging into an existing folder.
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  } else {
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  }
  return { from: source, to: target };
}
