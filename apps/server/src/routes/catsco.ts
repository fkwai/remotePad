import type { FastifyInstance } from 'fastify';
import { readCatsCoStatus } from '../catsco-status.ts';
import { agentHost } from '../agent/host.ts';

export async function registerCatsCoRoutes(app: FastifyInstance) {
  app.get('/api/catsco', async () => readCatsCoStatus());

  // Inbound from the local connector: it owns the channel, so it sees every
  // message the moment it lands. This replaces waiting for the next poll.
  app.post('/api/catsco/ingest', async (req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    // Awaited: a write's before-snapshot must exist before the tool runs.
    await agentHost.ingestCatsCoEvent({
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      topic: typeof body.topic === 'string' ? body.topic : undefined,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      phase: body.phase === 'start' || body.phase === 'end' ? body.phase : undefined,
      tool: typeof body.tool === 'string' ? body.tool : undefined,
      ok: typeof body.ok === 'boolean' ? body.ok : undefined,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
    });
    return { ok: true };
  });
}
