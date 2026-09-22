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
};
