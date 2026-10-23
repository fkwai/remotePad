import { defineConfig, devices } from '@playwright/test';
import { prepare } from './tests/e2e/support/prepare';

// Creates .e2e/ (isolated HOME, fixtures, settings) before any server starts.
const state = prepare();

// Ports are env-driven so parallel worktrees (scripts/dev-worktree.sh) do not
// collide; tests/server/* do not need them at all.
const UI_PORT = Number(process.env.E2E_UI_PORT || 3998);
const API_PORT = Number(process.env.E2E_API_PORT || 3999);

export default defineConfig({
  // tests/e2e = browser gestures, tests/server = node-level modules.
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  // One worker: the suite drives a single shared server + HOME.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bash tests/e2e/support/server.sh',
      url: `http://127.0.0.1:${API_PORT}/api/machine`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: './node_modules/.bin/vite --port ' + UI_PORT + ' --strictPort',
      cwd: 'apps/web',
      url: `http://127.0.0.1:${UI_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { REMOTEPAD_SETTINGS: state.settingsPath },
    },
  ],
});
