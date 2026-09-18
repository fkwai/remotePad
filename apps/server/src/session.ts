import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionState } from '@remotepad/shared';
import { config } from './config.ts';

export const SESSION_PATH = path.join(config.repoRoot, 'tmp', 'session.json');

const EMPTY: SessionState = {
  workspacePath: null,
  treeRoot: '/',
  selected: '/',
  expanded: ['/'],
  tabs: [],
  activePath: null,
  sideTab: 'favorites',
  termOpen: true,
};

function asState(raw: unknown): SessionState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const item = raw as Record<string, unknown>;
  const tabs = Array.isArray(item.tabs)
    ? item.tabs.flatMap((tab) => {
      if (!tab || typeof tab !== 'object') return [];
      const rec = tab as Record<string, unknown>;
      if (typeof rec.path !== 'string' || rec.path.startsWith('diff:')) return [];
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
  return {
    workspacePath: typeof item.workspacePath === 'string' ? item.workspacePath : null,
    treeRoot: typeof item.treeRoot === 'string' && item.treeRoot ? item.treeRoot : '/',
    selected: typeof item.selected === 'string' ? item.selected : null,
    expanded: expanded.length ? expanded : ['/'],
    tabs,
    activePath: typeof item.activePath === 'string' ? item.activePath : null,
    sideTab: item.sideTab === 'workspace' ? 'workspace' : 'favorites',
    termOpen: item.termOpen !== false,
  };
}

export async function readSession(): Promise<SessionState> {
  try {
    return asState(JSON.parse(await fs.readFile(SESSION_PATH, 'utf8')));
  } catch {
    return { ...EMPTY };
  }
}

export async function writeSession(input: SessionState): Promise<SessionState> {
  const state = asState(input);
  await fs.mkdir(path.dirname(SESSION_PATH), { recursive: true });
  const json = JSON.stringify(state, null, 2);
  const tmp = SESSION_PATH + '.tmp';
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, SESSION_PATH);
  return state;
}
