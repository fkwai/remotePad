import type { FastifyInstance } from 'fastify';
import type { SessionState } from '@remotepad/shared';
import { deleteWindow, listWindows, readSession, writeSession } from '../session.ts';

export async function registerSessionRoutes(app: FastifyInstance) {
  // `?w=` is the browser window. Each window restores its own layout, so two
  // tabs can work in two repos without fighting over tabs and tree root.
  app.get<{ Querystring: { w?: string } }>('/api/session', async (req) => readSession(req.query.w));

  app.put<{ Body: SessionState; Querystring: { w?: string } }>('/api/session', async (req) => {
    return writeSession(req.body || {} as SessionState, req.query.w);
  });

  /** Windows with a saved profile, for the switcher in the top bar. */
  app.get('/api/windows', async () => ({ windows: await listWindows() }));

  /** Forget a window: its saved profile is removed, nothing else is touched.
   *  Idempotent — forgetting a window that saved nothing already succeeded. */
  app.delete<{ Params: { id: string } }>('/api/windows/:id', async (req) => {
    const removed = await deleteWindow(req.params.id);
    return { ok: true, removed };
  });
}
