import type { FastifyInstance } from 'fastify';
import { PathError } from '../paths.ts';
import { CONTROL_PATH, listRepos, pinRepo, reorderRepos, unpinRepo } from '../workspaces.ts';

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  const payload = async () => ({
    repos: await listRepos(),
    controlPath: CONTROL_PATH,
  });

  app.get('/api/repos', async () => payload());
  app.get('/api/workspaces', async () => payload());

  app.post<{ Body: { path?: string } }>('/api/repos', async (req) => {
    if (!req.body?.path) throw new PathError('Path is required');
    return { repos: await pinRepo(req.body.path), controlPath: CONTROL_PATH };
  });
  app.post<{ Body: { path?: string } }>('/api/workspaces', async (req) => {
    if (!req.body?.path) throw new PathError('Path is required');
    return { repos: await pinRepo(req.body.path), controlPath: CONTROL_PATH };
  });

  app.put<{ Body: { paths?: string[] } }>('/api/repos/order', async (req) => {
    if (!Array.isArray(req.body?.paths)) throw new PathError('paths is required');
    return { repos: await reorderRepos(req.body.paths), controlPath: CONTROL_PATH };
  });

  app.delete<{ Querystring: { path?: string } }>('/api/repos', async (req) => {
    if (!req.query.path) throw new PathError('Path is required');
    return { repos: await unpinRepo(req.query.path), controlPath: CONTROL_PATH };
  });
  app.delete<{ Querystring: { path?: string } }>('/api/workspaces', async (req) => {
    if (!req.query.path) throw new PathError('Path is required');
    return { repos: await unpinRepo(req.query.path), controlPath: CONTROL_PATH };
  });
}
