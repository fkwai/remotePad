import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT } from '@remotepad/shared';

function splitRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(':').map((item) => item.trim()).filter(Boolean);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const installRoot = path.resolve(here, '../../..');

export const config = {
  host: process.env.REMOTEPAD_HOST || DEFAULT_HOST,
  port: Number(process.env.REMOTEPAD_PORT || DEFAULT_PORT),
  roots: [
    '/',
    os.homedir(),
    process.cwd(),
    installRoot,
    ...splitRoots(process.env.REMOTEPAD_ROOTS),
  ].map((item) => path.resolve(item)),
  textSizeLimit: Number(process.env.REMOTEPAD_TEXT_LIMIT || 8 * 1024 * 1024),
};
