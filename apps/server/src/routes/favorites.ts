import type { FastifyInstance } from 'fastify';
import { PathError } from '../paths.ts';
import { listFavorites, pinFavorite, reorderFavorites, unpinFavorite } from '../favorites.ts';

export async function registerFavoriteRoutes(app: FastifyInstance) {
  app.get('/api/favorites', async () => ({ folders: await listFavorites() }));

  app.post<{ Body: { path?: string } }>('/api/favorites', async (req) => {
    if (!req.body?.path) throw new PathError('Path is required');
    return { folders: await pinFavorite(req.body.path) };
  });

  app.put<{ Body: { paths?: string[] } }>('/api/favorites/order', async (req) => {
    if (!Array.isArray(req.body?.paths)) throw new PathError('paths is required');
    return { folders: await reorderFavorites(req.body.paths) };
  });

  app.delete<{ Querystring: { path?: string } }>('/api/favorites', async (req) => {
    if (!req.query.path) throw new PathError('Path is required');
    return { folders: await unpinFavorite(req.query.path) };
  });
}
