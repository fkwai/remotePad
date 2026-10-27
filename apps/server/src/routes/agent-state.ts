import type { FastifyInstance } from 'fastify';
import { agentHostFor } from '../agent/host.ts';

/** Internal state behind the Agent panel's Send/Stop button. */
export async function registerAgentStateRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { w?: string } }>('/api/agent/state', async (req) =>
    agentHostFor(req.query.w).diagnostics());

  /** Which session changed which file, and the text its next message will carry. */
  app.get<{ Querystring: { w?: string } }>('/api/agent/review', async (req) =>
    agentHostFor(req.query.w).reviewState());
}
