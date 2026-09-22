import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveRuntimeSettings } from '@remotepad/shared';

const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const settingsPath = process.env.REMOTEPAD_SETTINGS || path.join(installRoot, 'settings.json');
const { host, port, uiPort } = resolveRuntimeSettings(settingsPath);

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: uiPort,
    proxy: {
      '/api': { target: `http://${host}:${port}` },
      '/ws': { target: `ws://${host}:${port}`, ws: true },
    },
  },
  preview: {
    host,
    port: uiPort,
  },
});
