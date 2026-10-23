import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** One row as we keep it locally. `id` is the cloud message id, used to merge. */
export type StoredCatsCoMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  name?: string;
};

export type StoredCatsCoTranscript = {
  topic: string;
  lastId: number;
  updatedAt: number;
  messages: StoredCatsCoMessage[];
};

const MAX_MESSAGES = 400;

function storeDir(): string {
  const base = process.env.REMOTEPAD_STATE_DIR
    || path.join(os.homedir(), '.remotepad');
  return path.join(base, 'catsco');
}

function storeFile(topic: string): string {
  const safe = topic.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(storeDir(), `${safe}.json`);
}

export function readCatsCoTranscript(topic: string): StoredCatsCoTranscript | null {
  if (!topic) return null;
  try {
    const raw = fs.readFileSync(storeFile(topic), 'utf8');
    const parsed = JSON.parse(raw) as StoredCatsCoTranscript;
    if (!Array.isArray(parsed?.messages)) return null;
    return { ...parsed, topic, messages: parsed.messages.filter((m) => m && typeof m.id === 'number') };
  } catch {
    return null;
  }
}

export function writeCatsCoTranscript(topic: string, messages: StoredCatsCoMessage[]): void {
  if (!topic) return;
  const trimmed = messages.slice(-MAX_MESSAGES);
  const payload: StoredCatsCoTranscript = {
    topic,
    lastId: trimmed.length ? trimmed[trimmed.length - 1]!.id : 0,
    updatedAt: Date.now(),
    messages: trimmed,
  };
  try {
    fs.mkdirSync(storeDir(), { recursive: true });
    fs.writeFileSync(storeFile(topic), JSON.stringify(payload));
  } catch {
    // The cloud copy is authoritative; a failed write only costs one refetch.
  }
}

/**
 * Merge a freshly fetched window into what we already have.
 *
 * A turn is append-only in practice, so the newest id is enough to answer
 * "anything new?". Merging by id also survives the window sliding: old rows
 * fall out of the fetch but stay in our copy.
 */
export function mergeCatsCoTranscript(
  topic: string,
  incoming: StoredCatsCoMessage[],
): { messages: StoredCatsCoMessage[]; changed: boolean } {
  const previous = readCatsCoTranscript(topic)?.messages || [];
  const byId = new Map<number, StoredCatsCoMessage>();
  for (const item of previous) byId.set(item.id, item);
  let changed = false;
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing
      || existing.text !== item.text
      || existing.role !== item.role
      || existing.name !== item.name) {
      byId.set(item.id, item);
      changed = true;
    }
  }
  const merged = [...byId.values()].sort((a, b) => a.id - b.id);
  if (!changed && merged.length !== previous.length) changed = true;
  if (changed) writeCatsCoTranscript(topic, merged);
  return { messages: merged, changed };
}
