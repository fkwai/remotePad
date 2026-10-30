import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionSizes, SessionState, WindowInfo } from '@remotepad/shared';
import { config } from './config.ts';
import { sharedStateDir } from './state-paths.ts';

// UI restore state belongs with the rest of the user's state, not in the repo:
// `tmp/` was invisible next to the settings, got wiped with the checkout, and
// left every worktree with its own idea of "the window I left open".
// REMOTEPAD_SESSION_PATH still pins it for tests and preview lanes.
export const SESSION_PATH = process.env.REMOTEPAD_SESSION_PATH
  || path.join(sharedStateDir(), 'session', 'default.json');

/** Where this file used to live; read once so an upgrade keeps the open window. */
const LEGACY_SESSION_PATH = path.join(config.repoRoot, 'tmp', 'session.json');

const EMPTY: SessionState = {
  repoPath: null,
  treeRoot: '/',
  selected: '/',
  expanded: ['/'],
  tabs: [],
  activePath: null,
  splitPath: null,
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
    // Only a path that is still open survives: a split pointing at a closed tab
    // would render an empty pane on every reload.
    splitPath: typeof item.splitPath === 'string'
      && tabs.some((tab) => tab.path === item.splitPath) ? item.splitPath : null,
    sideTab,
    // Absent state means "never chosen", which opens the terminal (README/AGENTS);
    // an explicit false is a user choice and stays closed.
    termOpen: item.termOpen !== false,
    rightTab: 'agent',
    sizes: asSizes(item.sizes),
  };
}

/** Pane geometry: keep only plausible percentages and a 0..1 ratio. */
function asSizes(raw: unknown): SessionSizes | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const pct = (value: unknown): number[] | undefined => (Array.isArray(value)
    ? value.filter((n): n is number => typeof n === 'number' && n > 0 && n < 100)
    : undefined);
  const ratio = typeof item.splitRatio === 'number' && item.splitRatio > 0.1 && item.splitRatio < 0.9
    ? item.splitRatio
    : undefined;
  const cols = pct(item.cols);
  const main = pct(item.main);
  if (ratio === undefined && !cols && !main) return undefined;
  return {
    ...(ratio !== undefined ? { splitRatio: ratio } : {}),
    ...(cols ? { cols } : {}),
    ...(main ? { main } : {}),
  };
}

/** Remove a window's saved profile. `default` is kept: it is the plain link. */
export async function deleteWindow(id: string): Promise<boolean> {
  const win = windowId(id);
  if (win === 'default') return false;
  try {
    await fs.unlink(sessionPathFor(win));
    return true;
  } catch {
    return false;
  }
}

/** Every window (`?w=`) that has a saved profile, newest first. */
export async function listWindows(): Promise<WindowInfo[]> {
  const dir = path.dirname(SESSION_PATH);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const base = path.basename(SESSION_PATH).replace(/\.json$/, '');
  const out: WindowInfo[] = [];
  for (const name of names) {
    const match = name === `${base}.json`
      ? 'default'
      : name.startsWith(`${base}.`) && name.endsWith('.json')
        ? name.slice(base.length + 1, -'.json'.length)
        : null;
    if (!match || !/^[A-Za-z0-9_-]{1,32}$/.test(match)) continue;
    const file = path.join(dir, name);
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      const stat = await fs.stat(file);
      const repoPath = typeof raw.repoPath === 'string' ? raw.repoPath : null;
      const treeRoot = typeof raw.treeRoot === 'string' ? raw.treeRoot : null;
      // A window's own name is what the reader recognises: its repo, else the
      // folder it is looking at, else "empty".
      const named = repoPath || treeRoot;
      out.push({
        id: match,
        label: named ? (named.split('/').filter(Boolean).pop() || '/') : 'empty',
        path: named,
        updatedAt: stat.mtimeMs,
      });
    } catch {
      // Unreadable profile: skip rather than showing a broken entry.
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readSession(id?: string): Promise<SessionState> {
  const file = sessionPathFor(windowId(id));
  try {
    return asState(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    // First run after the move: adopt the old file instead of starting blank.
    if (file === SESSION_PATH) {
      try {
        return asState(JSON.parse(await fs.readFile(LEGACY_SESSION_PATH, 'utf8')));
      } catch {
        // Nothing to adopt.
      }
    }
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

  // The whole file is replaced on every save. Geometry arrives only from a
  // client that actually dragged something, so merge it field by field: a save
  // that omits the layout (typing, opening a tab) must not erase it, and a
  // client that has not loaded the profile yet must not overwrite it either.
  try {
    const previous = asState(JSON.parse(await fs.readFile(file, 'utf8')));
    if (previous.sizes) {
      const merged = { ...previous.sizes, ...(state.sizes || {}) };
      state.sizes = Object.keys(merged).length ? merged : undefined;
    }
  } catch {
    // No previous profile.
  }
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
