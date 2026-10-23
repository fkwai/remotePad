import type { FastifyInstance } from 'fastify';
import { appendFileSync } from 'node:fs';
import type { AgentClientMessage, AgentServerMessage } from '@remotepad/shared';
import { resolveSafe } from '../paths.ts';
import { agentHost } from './host.ts';

// TEMP diagnostic: prove whether browser clicks reach the server.
const WS_LOG = process.env.REMOTEPAD_WS_LOG || '/tmp/remotepad-ws.log';
function wsLog(line: string): void {
  try {
    appendFileSync(WS_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never break the socket */ }
}

function send(socket: { send: (data: string) => void }, msg: AgentServerMessage) {
  socket.send(JSON.stringify(msg));
}

export async function registerAgentSocket(app: FastifyInstance) {
  app.get('/ws/agent', { websocket: true }, (socket) => {
    const unsub = agentHost.subscribe((msg) => send(socket, msg));
    wsLog('open');

    socket.on('close', () => wsLog('close'));

    socket.on('message', (raw) => {
      let msg: AgentClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      wsLog(`recv ${msg.type}${'topicId' in msg ? ` ${msg.topicId}` : ''}${'backend' in msg ? ` ${msg.backend}` : ''}`);
      void (async () => {
        try {
          if (msg.type === 'hello') {
            const cwd = resolveSafe(msg.cwd);
            await agentHost.hello(cwd, msg.includeHistory !== false);
          } else if (msg.type === 'send') {
            await agentHost.send(msg.text);
          } else if (msg.type === 'stop') {
            agentHost.stop();
          } else if (msg.type === 'set_backend') {
            await agentHost.setBackend(msg.backend);
          } else if (msg.type === 'catsco_select') {
            await agentHost.selectCatsCoTopic(msg.topicId);
          } else if (msg.type === 'catsco_refresh') {
            await agentHost.refreshCatsCo();
          } else if (msg.type === 'catsco_project_create') {
            await agentHost.createCatsCoProject(msg.name);
          } else if (msg.type === 'catsco_task_create') {
            await agentHost.createCatsCoTask(msg.name, msg.projectId);
          } else if (msg.type === 'catsco_bot_switch') {
            await agentHost.switchCatsCoBot(msg.botUid);
          } else if (msg.type === 'clear') {
            agentHost.clear();
          } else if (msg.type === 'new') {
            await agentHost.newSession(Boolean(msg.helper));
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
          } else if (msg.type === 'publish') {
            await agentHost.publish();
          } else if (msg.type === 'preview') {
            await agentHost.preview();
          } else if (msg.type === 'merge') {
            await agentHost.merge();
          }
        } catch (err) {
          send(socket, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      })();
    });

    socket.on('close', unsub);
  });
}
