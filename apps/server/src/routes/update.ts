import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { applyUpdate, readUpdateStatus } from '../update.ts';

export async function registerUpdateRoutes(app: FastifyInstance) {
  app.get('/api/update', async () => readUpdateStatus(config.repoRoot));

  app.post('/api/update', async () => applyUpdate(config.repoRoot));
}
