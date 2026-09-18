import type { FastifyInstance } from 'fastify';
import type { SessionState } from '@remotepad/shared';
import { readSession, writeSession } from '../session.ts';

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/session', async () => readSession());

  app.put<{ Body: SessionState }>('/api/session', async (req) => {
    return writeSession(req.body || {} as SessionState);
  });
}
