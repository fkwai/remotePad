import { spawn } from 'node:child_process';
import path from 'node:path';
import { listPreviews } from './previews.ts';

/** Lanes a user can start from the version panel, in display order. */
export const LANES = ['dev', 'nightly'] as const;
export type LaneName = typeof LANES[number];

export type LaneState = {
  name: string;
  /** Branch the lane tracks. */
  branch: string;
  alive: boolean;
  uiPort?: number;
  apiPort?: number;
};

/**
 * Run a lane script without blocking the request.
 *
 * `lanes.sh start` creates or reuses a worktree and waits for the port; it can
 * take half a minute and must not hold an HTTP response open. The panel polls
 * `/api/lanes` instead, which is also what shows the port once it answers.
 */
function runScript(repo: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(path.join(repo, 'scripts', 'lanes.sh'), args, {
      cwd: repo,
      env: { ...process.env, PATH: `${process.env.PATH || ''}:/usr/local/bin:/usr/bin:/bin` },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (err) => resolve({ ok: false, output: `${output}${err.message}` }));
    child.on('close', (code) => resolve({ ok: code === 0, output: output.slice(-4000) }));
    // Long-lived: the caller has already been answered by then.
    child.unref();
  });
}

export function startLane(repo: string, name: string): void {
  if (!(LANES as readonly string[]).includes(name)) return;
  void runScript(repo, ['start', name]).then((result) => {
    if (!result.ok) console.warn(`[lanes] start ${name} failed: ${result.output.slice(-300)}`);
  });
}

export function stopLane(repo: string, name: string): void {
  if (!(LANES as readonly string[]).includes(name)) return;
  void runScript(repo, ['stop', name]).then((result) => {
    if (!result.ok) console.warn(`[lanes] stop ${name} failed: ${result.output.slice(-300)}`);
  });
}

/** Lane name → the preview directory it runs as, with its ports and liveness. */
export async function listLanes(repo: string): Promise<LaneState[]> {
  const previews = await listPreviews(repo);
  return LANES.map((name) => {
    const found = previews.find((item) => item.name === name);
    return {
      name,
      branch: name,
      alive: Boolean(found?.alive),
      uiPort: found?.uiPort,
      apiPort: found?.apiPort,
    };
  });
}
