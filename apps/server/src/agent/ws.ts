import type { FastifyInstance } from 'fastify';
import type { AgentClientMessage, AgentServerMessage } from '@remotepad/shared';
import { resolveSafe } from '../paths.ts';
import { agentHost } from './host.ts';

function send(socket: { send: (data: string) => void }, msg: AgentServerMessage) {
  socket.send(JSON.stringify(msg));
}

export async function registerAgentSocket(app: FastifyInstance) {
  app.get('/ws/agent', { websocket: true }, (socket) => {
    const unsub = agentHost.subscribe((msg) => send(socket, msg));

    socket.on('message', (raw) => {
      let msg: AgentClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      void (async () => {
        try {
          if (msg.type === 'hello') {
            const cwd = resolveSafe(msg.cwd);
            await agentHost.hello(cwd);
          } else if (msg.type === 'send') {
            await agentHost.send(msg.text);
          } else if (msg.type === 'stop') {
            agentHost.stop();
          } else if (msg.type === 'clear') {
            agentHost.clear();
          } else if (msg.type === 'new') {
            await agentHost.newSession();
          } else if (msg.type === 'open') {
            await agentHost.openSession(msg.id);
          } else if (msg.type === 'rename') {
            agentHost.renameSession(msg.id, msg.title);
          } else if (msg.type === 'delete') {
            await agentHost.deleteSession(msg.id);
          } else if (msg.type === 'accept') {
            await agentHost.accept(msg.path);
          } else if (msg.type === 'undo') {
            await agentHost.undo(msg.path);
          } else if (msg.type === 'accept_all') {
            await agentHost.acceptAll();
          } else if (msg.type === 'undo_all') {
            await agentHost.undoAll();
          }
        } catch (err) {
          send(socket, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      })();
    });

    socket.on('close', unsub);
  });
}
