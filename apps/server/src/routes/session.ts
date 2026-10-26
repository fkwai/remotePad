import type { FastifyInstance } from 'fastify';
import type { SessionState } from '@remotepad/shared';
import { readSession, writeSession } from '../session.ts';

export async function registerSessionRoutes(app: FastifyInstance) {
  // `?w=` is the browser window. Each window restores its own layout, so two
  // tabs can work in two repos without fighting over tabs and tree root.
  app.get<{ Querystring: { w?: string } }>('/api/session', async (req) => readSession(req.query.w));

  app.put<{ Body: SessionState; Querystring: { w?: string } }>('/api/session', async (req) => {
    return writeSession(req.body || {} as SessionState, req.query.w);
  });
}
