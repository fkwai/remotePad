import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { applyUpdate, listChannels, readUpdateStatus, switchChannel } from '../update.ts';

export async function registerUpdateRoutes(app: FastifyInstance) {
  app.get('/api/update', async () => readUpdateStatus(config.repoRoot));

  app.post('/api/update', async () => applyUpdate(config.repoRoot));

  /** stable / dev / nightly, with how far each is from this checkout. */
  app.get('/api/channels', async () => ({ channels: await listChannels(config.repoRoot) }));

  app.post<{ Body: { channel?: string } }>('/api/channels', async (req) =>
    switchChannel(config.repoRoot, String(req.body?.channel || '')));
}
