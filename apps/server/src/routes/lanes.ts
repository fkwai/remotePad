import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { LANES, listLanes, startLane, stopLane } from '../lanes.ts';

export async function registerLaneRoutes(app: FastifyInstance) {
  /** dev / nightly beside this install, with whether they answer right now. */
  app.get('/api/lanes', async () => ({ lanes: await listLanes(config.repoRoot) }));

  // Fire and forget: starting a lane builds a worktree and can take a minute.
  // The panel polls /api/lanes until the port answers.
  app.post<{ Params: { name: string } }>('/api/lanes/:name/start', async (req, reply) => {
    if (!(LANES as readonly string[]).includes(req.params.name)) {
      return reply.code(400).send({ ok: false, error: 'unknown lane' });
    }
    startLane(config.repoRoot, req.params.name);
    return { ok: true, starting: req.params.name };
  });

  app.post<{ Params: { name: string } }>('/api/lanes/:name/stop', async (req, reply) => {
    if (!(LANES as readonly string[]).includes(req.params.name)) {
      return reply.code(400).send({ ok: false, error: 'unknown lane' });
    }
    stopLane(config.repoRoot, req.params.name);
    return { ok: true, stopping: req.params.name };
  });
}
