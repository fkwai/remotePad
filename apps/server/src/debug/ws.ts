import type { FastifyInstance } from 'fastify';
import type { DebugClientMessage } from '@remotepad/shared';
import { sessions } from './session.ts';

export async function registerDebugSocket(app: FastifyInstance) {
  app.get('/ws/debug', { websocket: true }, (socket, req) => {
    const id = new URL(req.url || '/ws/debug', 'http://localhost').searchParams.get('id') || '';
    const session = sessions.get(id);
    if (!session) {
      socket.send(JSON.stringify({ type: 'error', message: `Unknown debug session ${id}` }));
      socket.close();
      return;
    }
    session.attach(socket);
    socket.on('message', (raw) => {
      let message: DebugClientMessage;
      try {
        message = JSON.parse(String(raw));
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }
      session.handle(message);
    });
    socket.on('close', () => session.detach(socket));
  });
}
