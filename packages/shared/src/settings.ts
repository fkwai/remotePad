import fs from 'node:fs';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3847;
export const DEFAULT_UI_PORT = 5173;

export interface RemotePadSettings {
  host: string;
  port: number;
  uiPort: number;
}

const DEFAULTS: RemotePadSettings = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  uiPort: DEFAULT_UI_PORT,
};

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function pickPort(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : fallback;
}

export function readSettingsFile(filePath: string): RemotePadSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RemotePadSettings>;
    return {
      host: pickString(raw.host, DEFAULTS.host),
      port: pickPort(raw.port, DEFAULTS.port),
      uiPort: pickPort(raw.uiPort, DEFAULTS.uiPort),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function resolveRuntimeSettings(filePath: string): RemotePadSettings {
  const file = readSettingsFile(filePath);
  return {
    host: process.env.REMOTEPAD_HOST || file.host,
    port: Number(process.env.REMOTEPAD_PORT || file.port),
    uiPort: Number(process.env.REMOTEPAD_UI_PORT || file.uiPort),
  };
}
