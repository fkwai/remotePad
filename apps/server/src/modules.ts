import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveViewerEnabled,
  isViewerModuleId,
  VIEWER_MODULES,
  type ModulesResponse,
  type ViewerEnabledMap,
  type ViewerModuleId,
} from '@remotepad/shared';

const FILE = path.join(os.homedir(), '.remotepad', 'modules.json');

interface Store {
  modules?: ViewerEnabledMap;
}

async function readStore(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8')) as Store;
    const modules: ViewerEnabledMap = {};
    if (raw.modules && typeof raw.modules === 'object') {
      for (const [key, value] of Object.entries(raw.modules)) {
        if (isViewerModuleId(key) && typeof value === 'boolean') modules[key] = value;
      }
    }
    return { modules };
  } catch {
    return { modules: {} };
  }
}

async function writeStore(store: Store) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ modules: store.modules || {} }, null, 2));
}

export async function readModules(): Promise<ModulesResponse> {
  const store = await readStore();
  return {
    catalog: VIEWER_MODULES,
    enabled: resolveViewerEnabled(store.modules || {}),
    path: FILE,
  };
}

export async function setModule(id: ViewerModuleId, on: boolean): Promise<ModulesResponse> {
  const store = await readStore();
  const modules = { ...(store.modules || {}), [id]: on };
  await writeStore({ modules });
  return {
    catalog: VIEWER_MODULES,
    enabled: resolveViewerEnabled(modules),
    path: FILE,
  };
}
