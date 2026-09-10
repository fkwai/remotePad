import type { FastifyInstance } from 'fastify';
import type { TermClientMessage, TermServerMessage } from '@remotepad/shared';
import { sessions } from './sessionManager.ts';

function send(socket: { send: (data: string) => void }, msg: TermServerMessage) {
  socket.send(JSON.stringify(msg));
}

export async function registerTermSocket(app: FastifyInstance) {
  app.get('/ws/term', { websocket: true }, (socket) => {
    const attached = new Map<string, { dispose: () => void }>();

    const detachAll = () => {
      for (const handle of attached.values()) handle.dispose();
      attached.clear();
    };

    const attach = (id: string, replay: boolean) => {
      const session = sessions.get(id);
      if (!session) {
        send(socket, { type: 'error', message: `Unknown session ${id}` });
        return;
      }
      if (attached.has(id)) return;
      const onData = session.proc?.onData((data) => send(socket, { type: 'data', id, data }));
      const onExit = session.proc?.onExit(({ exitCode }) => {
        send(socket, { type: 'exit', id, code: exitCode });
      });
      attached.set(id, {
        dispose: () => {
          onData?.dispose();
          onExit?.dispose();
        },
      });
      send(socket, {
        type: 'attached',
        session: sessions.info(session),
        replay: replay ? session.replay : '',
      });
    };

    send(socket, { type: 'list', sessions: sessions.list() });

    socket.on('message', (raw) => {
      let msg: TermClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      try {
        if (msg.type === 'list') {
          send(socket, { type: 'list', sessions: sessions.list() });
        } else if (msg.type === 'create') {
          const session = sessions.create({
            cwd: msg.cwd,
            name: msg.name,
            cols: msg.cols,
            rows: msg.rows,
          });
          send(socket, { type: 'created', session: sessions.info(session) });
          attach(session.id, false);
        } else if (msg.type === 'attach') {
          if (msg.cols && msg.rows) sessions.resize(msg.id, msg.cols, msg.rows);
          attach(msg.id, true);
        } else if (msg.type === 'input') {
          sessions.write(msg.id, msg.data);
        } else if (msg.type === 'resize') {
          sessions.resize(msg.id, msg.cols, msg.rows);
        } else if (msg.type === 'rename') {
          const session = sessions.rename(msg.id, msg.name);
          send(socket, { type: 'renamed', session: sessions.info(session) });
          send(socket, { type: 'list', sessions: sessions.list() });
        } else if (msg.type === 'close') {
          attached.get(msg.id)?.dispose();
          attached.delete(msg.id);
          sessions.close(msg.id);
          send(socket, { type: 'closed', id: msg.id });
          send(socket, { type: 'list', sessions: sessions.list() });
        }
      } catch (err) {
        send(socket, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('close', detachAll);
  });
}
