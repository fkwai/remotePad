import type { FastifyInstance } from 'fastify';
import type { ModulesToggleBody } from '@remotepad/shared';
import { isViewerModuleId } from '@remotepad/shared';
import { PathError } from '../paths.ts';
import { readModules, setModule } from '../modules.ts';

export async function registerModuleRoutes(app: FastifyInstance) {
  app.get('/api/modules', async () => readModules());

  app.put<{ Body: ModulesToggleBody }>('/api/modules', async (req) => {
    const id = req.body?.id;
    if (!id || !isViewerModuleId(id)) throw new PathError('Unknown module', 400);
    if (typeof req.body?.on !== 'boolean') throw new PathError('on must be boolean', 400);
    return setModule(id, req.body.on);
  });
}
