import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { PreviewInfo } from '@remotepad/shared';

/**
 * Running previews started by `scripts/preview.sh`.
 *
 * They live in `<repo>/.previews/<name>/` next to a `ui`/`api` port file, so the
 * running instance can report them without talking to the previews themselves.
 */
/**
 * Where preview.sh keeps its state: always the *main* checkout.
 *
 * A preview runs from a worktree, but preview.sh writes `.previews/` next to the
 * checkout the user ran it from. Inside a worktree, `repo` is that worktree, so
 * resolve the shared git dir and use its parent.
 */
export function previewsDir(repo: string): string {
  try {
    const common = execFileSync(
      'git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (common) return path.join(path.dirname(common), '.previews');
  } catch {
    // Not a git checkout (or git missing): fall back to the repo itself.
  }
  return path.join(repo, '.previews');
}

function portFrom(file: string): number | undefined {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}

function probe(port: number, host = '127.0.0.1', timeout = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** List the previews on disk, with a liveness check per preview. */
export async function listPreviews(repo: string): Promise<PreviewInfo[]> {
  const dir = previewsDir(repo);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const found: PreviewInfo[] = [];
  for (const name of names) {
    const base = path.join(dir, name);
    const ui = portFrom(path.join(base, 'ui'));
    if (!ui) continue;
    const api = portFrom(path.join(base, 'api'));
    found.push({ name, uiPort: ui, apiPort: api, alive: false });
  }

  await Promise.all(found.map(async (item) => {
    item.alive = await probe(item.uiPort);
  }));

  return found.sort((a, b) => a.name.localeCompare(b.name));
}
