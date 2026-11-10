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
  build: {
    rollupOptions: {
      output: {
        // Monaco is now part of the bundle rather than a CDN fetch. Keeping the
        // editor core in its own chunk lets the app shell parse while the editor
        // downloads, and lets it be cached across deployments; the per-language
        // chunks stay dynamic so only the language in use is fetched.
        manualChunks(id) {
          if (!id.includes('/monaco-editor/esm/vs/')) return undefined;
          if (id.includes('/basic-languages/') || id.includes('/language/')) return undefined;
          return 'monaco';
        },
      },
    },
  },
  server: {
    host,
    port: uiPort,
    // Fail loudly instead of drifting to 5174 when a stray instance holds the
    // port: a silent port change points the browser and the docs at nothing.
    strictPort: true,
    proxy: {
      '/api': { target: `http://${host}:${port}` },
      '/ws': { target: `ws://${host}:${port}`, ws: true },
    },
  },
  preview: {
    host,
    port: uiPort,
    strictPort: true,
  },
});
