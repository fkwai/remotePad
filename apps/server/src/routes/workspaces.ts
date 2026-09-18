import type { FastifyInstance } from 'fastify';
import { PathError } from '../paths.ts';
import { CONTROL_PATH, listWorkspaces, pinWorkspace, unpinWorkspace } from '../workspaces.ts';

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async () => ({
    folders: await listWorkspaces(),
    controlPath: CONTROL_PATH,
  }));

  app.post<{ Body: { path?: string } }>('/api/workspaces', async (req) => {
    if (!req.body?.path) throw new PathError('Path is required');
    return { folders: await pinWorkspace(req.body.path), controlPath: CONTROL_PATH };
  });

  app.delete<{ Querystring: { path?: string } }>('/api/workspaces', async (req) => {
    if (!req.query.path) throw new PathError('Path is required');
    return { folders: await unpinWorkspace(req.query.path), controlPath: CONTROL_PATH };
  });
}
