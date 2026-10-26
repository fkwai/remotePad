import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { listPreviews } from '../previews.ts';

export async function registerPreviewRoutes(app: FastifyInstance) {
  app.get('/api/previews', async () => ({ previews: await listPreviews(config.repoRoot) }));
}
