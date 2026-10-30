import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { applyUpdate, listChannels, readUpdateStatus } from '../update.ts';

export async function registerUpdateRoutes(app: FastifyInstance) {
  // `?remote=0` answers from local git only. Reading behind/ahead needs a fetch
  // to origin, which on a slow link costs seconds — and the panel only needs the
  // version, branch and commit to draw itself.
  app.get<{ Querystring: { remote?: string } }>('/api/update', async (req) => {
    const remote = req.query.remote !== '0';
    return readUpdateStatus(config.repoRoot, remote ? {} : { fetch: false });
  });

  app.post('/api/update', async () => applyUpdate(config.repoRoot));

  /** stable / dev / nightly, with how far each is from this checkout. */
  app.get('/api/channels', async () => ({ channels: await listChannels(config.repoRoot) }));
}
