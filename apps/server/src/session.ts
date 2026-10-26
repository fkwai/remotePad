import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionState } from '@remotepad/shared';
import { config } from './config.ts';

// Overridable so a test instance can keep its own UI restore state instead of
// sharing tmp/session.json with the live app on the same install.
export const SESSION_PATH = process.env.REMOTEPAD_SESSION_PATH
  || path.join(config.repoRoot, 'tmp', 'session.json');

const EMPTY: SessionState = {
  repoPath: null,
  treeRoot: '/',
  selected: '/',
  expanded: ['/'],
  tabs: [],
  activePath: null,
  sideTab: 'favorites',
  termOpen: true,
  rightTab: 'agent',
};

/**
 * Which window (browser tab) this state belongs to.
 *
 * Two windows are two workspaces: one can sit in repo A while the other sits in
 * repo B. The id rides along as `?w=`; anything unrecognised is the default
 * window, so an old link keeps working.
 */
export function windowId(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : 'default';
}

/** Path for a window's restore state; the default window keeps the old file. */
export function sessionPathFor(id: string): string {
  const win = windowId(id);
  if (win === 'default') return SESSION_PATH;
  return SESSION_PATH.replace(/\.json$/, `.${win}.json`);
}

function asState(raw: unknown): SessionState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const item = raw as Record<string, unknown>;
  const tabs = Array.isArray(item.tabs)
    ? item.tabs.flatMap((tab) => {
      if (!tab || typeof tab !== 'object') return [];
      const rec = tab as Record<string, unknown>;
      if (typeof rec.path !== 'string' || rec.path.startsWith('diff:') || rec.path.startsWith('agent:')) return [];
      const modes = ['rendered', 'source', 'icons', 'details'] as const;
      const viewMode = modes.includes(rec.viewMode as typeof modes[number])
        ? rec.viewMode as typeof modes[number]
        : 'rendered';
      return [{
        path: rec.path,
        viewMode,
        folder: rec.folder === true,
      }];
    })
    : [];
  const expanded = Array.isArray(item.expanded)
    ? item.expanded.filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
    : ['/'];
  const repoPath = typeof item.repoPath === 'string'
    ? item.repoPath
    : (typeof item.workspacePath === 'string' ? item.workspacePath : null);
  const sideTab = item.sideTab === 'repos' || item.sideTab === 'workspace' ? 'repos' : 'favorites';
  return {
    repoPath,
    treeRoot: typeof item.treeRoot === 'string' && item.treeRoot ? item.treeRoot : '/',
    selected: typeof item.selected === 'string' ? item.selected : null,
    expanded: expanded.length ? expanded : ['/'],
    tabs,
    activePath: typeof item.activePath === 'string' ? item.activePath : null,
    sideTab,
    // Absent state means "never chosen", which opens the terminal (README/AGENTS);
    // an explicit false is a user choice and stays closed.
    termOpen: item.termOpen !== false,
    rightTab: 'agent',
  };
}

export async function readSession(id?: string): Promise<SessionState> {
  const file = sessionPathFor(windowId(id));
  try {
    return asState(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return { ...EMPTY };
  }
}

/** Serialized so two UI requests cannot race on the same temp file.
 *  The rename failed with ENOENT whenever session writes overlapped, which
 *  surfaced as a 500 on /api/session and lost the layout state. */
let sessionWrite: Promise<unknown> = Promise.resolve();

export async function writeSession(input: SessionState, id?: string): Promise<SessionState> {
  const state = asState(input);
  const file = sessionPathFor(windowId(id));
  const run = sessionWrite.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // A per-write temp name keeps this safe even across processes.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, file);
    return state;
  });
  sessionWrite = run.catch(() => undefined);
  return run;
}
