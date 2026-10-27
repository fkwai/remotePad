import type { FastifyInstance } from 'fastify';
import type { DebugClientMessage } from '@remotepad/shared';
import { resolveSafe } from '../paths.ts';
import { sessions, startSession } from '../debug/session.ts';

interface BreakpointBody { path: string; line: number }

function normalizeBreakpoints(input: unknown): BreakpointBody[] {
  if (!Array.isArray(input)) return [];
  const out: BreakpointBody[] = [];
  for (const item of input) {
    const candidate = item as { path?: unknown; line?: unknown };
    if (typeof candidate?.path !== 'string') continue;
    const line = Math.floor(Number(candidate.line));
    if (!Number.isFinite(line) || line < 1) continue;
    try {
      out.push({ path: resolveSafe(candidate.path), line });
    } catch {
      // outside allowed roots — ignore rather than fail the whole session
    }
  }
  return out;
}

export async function registerDebugRoutes(app: FastifyInstance) {
  app.get('/api/debug/sessions', async () => ({
    sessions: [...sessions.values()].map((session) => session.state()),
  }));

  app.post<{ Body: { path?: string; breakpoints?: unknown } }>('/api/debug/start', async (req) => {
    const target = resolveSafe(req.body?.path || '');
    const breakpoints = normalizeBreakpoints(req.body?.breakpoints);
    const session = startSession(target, breakpoints);
    return { session: session.state() };
  });

  app.post<{ Body: { id?: string; breakpoints?: unknown } }>('/api/debug/breakpoints', async (req) => {
    const session = sessions.get(String(req.body?.id || ''));
    if (!session) return { ok: false, error: 'Unknown debug session' };
    const breakpoints = normalizeBreakpoints(req.body?.breakpoints);
    session.handle({ type: 'breakpoints', breakpoints });
    return { ok: true, breakpoints };
  });

  app.post<{
    Body: { id?: string; action?: string; frameId?: number; expression?: string };
  }>('/api/debug/control', async (req) => {
    const session = sessions.get(String(req.body?.id || ''));
    if (!session) return { ok: false, error: 'Unknown debug session' };
    const action = String(req.body?.action || '');
    const frameId = Math.max(0, Math.floor(Number(req.body?.frameId) || 0));
    const expression = String(req.body?.expression || '').slice(0, 2000);
    const map: Record<string, DebugClientMessage> = {
      resume: { type: 'resume' },
      stepOver: { type: 'stepOver' },
      stepInto: { type: 'stepInto' },
      stepOut: { type: 'stepOut' },
      pause: { type: 'pause' },
      stop: { type: 'stop' },
      variables: { type: 'variables', frameId },
      evaluate: { type: 'evaluate', frameId, expression },
    };
    const message = map[action];
    if (!message) return { ok: false, error: `Unknown action ${action}` };
    session.handle(message);
    return { ok: true, session: session.state() };
  });

  app.delete<{ Querystring: { id?: string } }>('/api/debug/session', async (req) => {
    const session = sessions.get(String(req.query?.id || ''));
    if (!session) return { ok: false, error: 'Unknown debug session' };
    session.stop();
    return { ok: true };
  });
}
