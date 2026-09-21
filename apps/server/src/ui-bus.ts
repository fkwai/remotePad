import type { WatchServerMessage } from '@remotepad/shared';

type Listener = (msg: WatchServerMessage) => void;

const listeners = new Set<Listener>();

export function subscribeUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishUi(msg: WatchServerMessage): void {
  for (const listener of listeners) {
    try { listener(msg); } catch { /* ignore broken sockets */ }
  }
}

export function publishOpen(path: string, extra?: { termId?: string; title?: string }): void {
  publishUi({ type: 'open', path, termId: extra?.termId, title: extra?.title });
}
