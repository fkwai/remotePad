import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 6000;
export const DEFAULT_UI_PORT = 6001;

/**
 * Ports are grouped in blocks of ten, one block per machine: 600 here, 601 the
 * shared server, 603 the box that runs the agents. The offsets inside a block are
 * the same everywhere (see scripts/ports.sh), so "dev is base+2" is true on every
 * machine and a tunnel is a lookup rather than a thing to remember.
 *
 * The committed settings.json names the laptop's block. A machine that is not the
 * laptop sets REMOTEPAD_PORT_BLOCK, which shifts the defaults by whole blocks —
 * one variable instead of editing a tracked file on each host.
 */
function blockShift(): number {
  const block = Number(process.env.REMOTEPAD_PORT_BLOCK || markerBlock());
  if (!Number.isFinite(block) || block < 1) return 0;
  return (Math.floor(block) - 600) * 10;
}

/** `~/​.remotepad-port-block` says which block this machine uses (600, 601, 603). */
function markerBlock(): string {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.remotepad-port-block'), 'utf8').replace(/\D/g, '').slice(0, 3);
  } catch {
    return '';
  }
}

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

/**
 * A settings file that still names the laptop's default is a default, not a
 * decision: on another machine the whole block moves it. A port written by a
 * preview or the test harness is a decision and is left alone.
 */
function shiftDefault(value: number, laptopDefault: number, shift: number): number {
  return value === laptopDefault ? value + shift : value;
}

export function readSettingsFile(filePath: string): RemotePadSettings {
  const shift = blockShift();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RemotePadSettings>;
    return {
      host: pickString(raw.host, DEFAULTS.host),
      port: shiftDefault(pickPort(raw.port, DEFAULTS.port), DEFAULTS.port, shift),
      uiPort: shiftDefault(pickPort(raw.uiPort, DEFAULTS.uiPort), DEFAULTS.uiPort, shift),
    };
  } catch {
    return { host: DEFAULTS.host, port: DEFAULTS.port + shift, uiPort: DEFAULTS.uiPort + shift };
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
