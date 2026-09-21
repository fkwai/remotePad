import chokidar, { type FSWatcher } from 'chokidar';
import type { FastifyInstance } from 'fastify';
import type { WatchClientMessage, WatchServerMessage } from '@remotepad/shared';
import { resolveSafe } from './paths.ts';
import { subscribeUi } from './ui-bus.ts';

function send(socket: { send: (data: string) => void }, msg: WatchServerMessage) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // socket may already be closed
  }
}

export async function registerWatchSocket(app: FastifyInstance) {
  app.get('/ws/events', { websocket: true }, (socket) => {
    const watchers = new Map<string, FSWatcher>();
    const unsubscribe = subscribeUi((msg) => send(socket, msg));

    const unwatch = async (target: string) => {
      const watcher = watchers.get(target);
      if (!watcher) return;
      watchers.delete(target);
      await watcher.close();
    };

    const watch = (input: string) => {
      const target = resolveSafe(input);
      if (watchers.has(target)) return;
      const watcher = chokidar.watch(target, {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
      });
      watcher.on('all', (event, changed) => {
        send(socket, { type: 'change', path: changed || target, event });
      });
      watcher.on('error', (err) => {
        send(socket, { type: 'error', message: String(err) });
      });
      watchers.set(target, watcher);
    };

    socket.on('message', (raw) => {
      let msg: WatchClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      try {
        if (msg.type === 'watch') watch(msg.path);
        if (msg.type === 'unwatch') void unwatch(resolveSafe(msg.path));
      } catch (err) {
        send(socket, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('close', () => {
      unsubscribe();
      for (const watcher of watchers.values()) void watcher.close();
      watchers.clear();
    });
  });
}
