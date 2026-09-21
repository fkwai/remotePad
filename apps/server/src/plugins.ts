import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';

export type PluginKind = 'terminal' | 'ui';

export type PluginManifest = {
  id: string;
  kind: PluginKind[];
  pythonPath?: string;
  startup?: string;
  root: string;
};

export type TerminalPluginEnv = {
  env: Record<string, string>;
  pythonPaths: string[];
  startups: string[];
};

function readManifest(dir: string): PluginManifest | null {
  const fp = path.join(dir, 'plugin.json');
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as {
      id?: string;
      kind?: string[];
      pythonPath?: string;
      startup?: string;
    };
    if (!raw.id || !Array.isArray(raw.kind)) return null;
    const kind = raw.kind.filter((item): item is PluginKind => item === 'terminal' || item === 'ui');
    if (!kind.length) return null;
    return {
      id: raw.id,
      kind,
      pythonPath: raw.pythonPath,
      startup: raw.startup,
      root: dir,
    };
  } catch {
    return null;
  }
}

export function listPlugins(): PluginManifest[] {
  const root = config.pluginsDir;
  if (!fs.existsSync(root)) return [];
  const out: PluginManifest[] = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifest = readManifest(dir);
    if (manifest) out.push(manifest);
  }
  return out;
}

export function terminalPluginEnv(): TerminalPluginEnv {
  const env: Record<string, string> = {};
  const pythonPaths: string[] = [];
  const startups: string[] = [];
  for (const plugin of listPlugins()) {
    if (!plugin.kind.includes('terminal')) continue;
    if (plugin.pythonPath) {
      const py = path.resolve(plugin.root, plugin.pythonPath);
      if (fs.existsSync(py)) pythonPaths.push(py);
    }
    if (plugin.startup) {
      const startup = path.resolve(plugin.root, plugin.startup);
      if (fs.existsSync(startup)) startups.push(startup);
    }
  }
  return { env, pythonPaths, startups };
}

export function writeRuntimeFile(): { url: string; path: string } {
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  const dir = path.join(os.homedir(), '.remotepad');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'runtime.json');
  fs.writeFileSync(fp, JSON.stringify({
    url,
    host: config.host,
    port: config.port,
    pluginsDir: config.pluginsDir,
    writtenAt: new Date().toISOString(),
  }, null, 2));
  return { url, path: fp };
}

export function buildTerminalEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const runtime = writeRuntimeFile();
  const plugins = terminalPluginEnv();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.TERM = env.TERM || 'xterm-256color';
  env.REMOTEPAD_URL = runtime.url;
  env.REMOTEPAD_PLOT_DIR = path.join(os.homedir(), '.remotepad', 'plots');

  const paths = [...plugins.pythonPaths];
  if (env.PYTHONPATH) paths.push(env.PYTHONPATH);
  if (paths.length) env.PYTHONPATH = paths.join(path.delimiter);

  if (plugins.startups.length) {
    if (env.PYTHONSTARTUP) env.REMOTEPAD_PREV_PYTHONSTARTUP = env.PYTHONSTARTUP;
    // Chain: last plugin startup is the entry; it should chain PREV.
    // For multiple plugins, write a small aggregator later; v1 uses the last startup
    // and prepends python paths so all helpers import.
    env.PYTHONSTARTUP = plugins.startups[plugins.startups.length - 1];
    if (plugins.startups.length > 1) {
      env.REMOTEPAD_PLUGIN_STARTUPS = plugins.startups.join(path.delimiter);
    }
  }

  Object.assign(env, plugins.env);
  return env;
}
