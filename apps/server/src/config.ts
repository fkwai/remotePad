import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeSettings } from '@remotepad/shared';

function splitRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(':').map((item) => item.trim()).filter(Boolean);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const installRoot = path.resolve(here, '../../..');

const settingsPath = process.env.REMOTEPAD_SETTINGS || path.join(installRoot, 'settings.json');
const runtime = resolveRuntimeSettings(settingsPath);

export const config = {
  host: runtime.host,
  port: runtime.port,
  uiPort: runtime.uiPort,
  roots: [
    '/',
    os.homedir(),
    process.cwd(),
    installRoot,
    ...splitRoots(process.env.REMOTEPAD_ROOTS),
  ].map((item) => path.resolve(item)),
  textSizeLimit: Number(process.env.REMOTEPAD_TEXT_LIMIT || 8 * 1024 * 1024),
  repoRoot: installRoot,
  pluginsDir: path.join(installRoot, 'plugins'),
  xiaobaPath: path.resolve(process.env.REMOTEPAD_XIAOBA_PATH || path.join(installRoot, '..', 'XiaoBa-CLI')),
  xiaobaDataDir: path.join(os.homedir(), '.remotepad', 'xiaoba'),
  /** Session files written by the agent on this machine.
   *
   * The agent runs under this same user, so its transcript is a local file we
   * can read and tail. That removes the Dashboard from the transcript path
   * entirely: history is a file read, and new records arrive by watch.
   */
  agentSessionsDir: path.resolve(
    process.env.REMOTEPAD_AGENT_SESSIONS
      || path.join(os.homedir(), 'data', 'sessions'),
  ),
  /** Existing XiaoBa Dashboard (owns connector). Default loopback :3800. */
  catscoDashboardUrl: String(process.env.REMOTEPAD_CATSCO_DASHBOARD || 'http://127.0.0.1:3800').replace(/\/$/, ''),
};
