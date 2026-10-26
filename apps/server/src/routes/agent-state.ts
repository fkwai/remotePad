import type { FastifyInstance } from 'fastify';
import { agentHost } from '../agent/host.ts';

/** Internal state behind the Agent panel's Send/Stop button. */
export async function registerAgentStateRoutes(app: FastifyInstance) {
  app.get('/api/agent/state', async () => agentHost.diagnostics());
}
