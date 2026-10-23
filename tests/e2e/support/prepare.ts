import fs from 'node:fs';
import path from 'node:path';

// Playwright loads this file through its TS-to-CJS transform, so __dirname is
// available and import.meta is not.
const supportDir = __dirname;
export const repoRoot = path.resolve(supportDir, '../../..');

const stateDir = path.join(repoRoot, '.e2e');
const home = path.join(stateDir, 'home');
const work = path.join(stateDir, 'work');
const settingsPath = path.join(stateDir, 'settings.json');
const sessionFile = path.join(stateDir, 'session.json');
const statePath = path.join(stateDir, 'state.json');

const files: Record<string, string> = {
  'a.md': '# Alpha\n\nMarkdown body.\n',
  'b.csv': 'name,qty\nwidget,3\ngadget,7\n',
  'notes.txt': 'plain text fixture\n',
  'sub/c.json': '{\n  "nested": true\n}\n',
  'sub/d.md': '# Delta\n',
};

export interface E2EState {
  stateDir: string;
  home: string;
  work: string;
  settingsPath: string;
  sessionFile: string;
  fixture: { root: string; markdown: string; csv: string; nestedJson: string };
}

/**
 * Prepare an isolated RemotePad runtime for e2e tests.
 *
 * Runs synchronously from playwright.config.ts, before any webServer starts.
 * Every piece of shared state is redirected into .e2e/:
 *  - HOME                -> .e2e/home (favorites, repos, plots, agent sessions);
 *  - REMOTEPAD_SETTINGS  -> .e2e/settings.json (API :3999, vite :3998);
 *  - REMOTEPAD_SESSION_PATH -> .e2e/session.json (UI restore state);
 *  - fixtures            -> .e2e/work.
 * Nothing here touches the live app's data or this repo's tmp/.
 */
export function prepare(): E2EState {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, '.remotepad'), { recursive: true });
  fs.mkdirSync(path.join(work, 'sub'), { recursive: true });

  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(work, name), body);
  }

  fs.writeFileSync(settingsPath, JSON.stringify({ host: '127.0.0.1', port: 3999, uiPort: 3998 }, null, 2));

  // A seeded favorites store pins the fixture folder as the tree root, so tree
  // tests do not depend on the real filesystem layout.
  fs.writeFileSync(
    path.join(home, '.remotepad', 'favorites.json'),
    JSON.stringify({ seeded: true, folders: [{ path: work, name: 'fixture' }] }, null, 2),
  );

  // Each test resets this over PUT /api/session; the file itself is private to
  // the test instance and is thrown away with .e2e/.
  fs.writeFileSync(sessionFile, '{}');

  const state: E2EState = {
    stateDir,
    home,
    work,
    settingsPath,
    sessionFile,
    fixture: {
      root: work,
      markdown: path.join(work, 'a.md'),
      csv: path.join(work, 'b.csv'),
      nestedJson: path.join(work, 'sub', 'c.json'),
    },
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state;
}

export { stateDir, statePath, sessionFile, settingsPath, work, home };
