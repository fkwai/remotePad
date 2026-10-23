import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';

/** One line of the agent's session file, as the panel understands it. */
export type AgentRecord = {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  name?: string;
  toolCallId?: string;
};

/**
 * The agent writes its transcript as append-only JSONL under the same user that
 * runs remotePad, so the panel can read it directly and follow it by watch.
 *
 * This is what makes the on-machine case work without the Dashboard: no REST
 * polling, no snapshot lag, and the turn's own file is the single source of
 * truth. Nothing here reaches the network.
 */

/** The agent names session files after the surface, so match on the topic id. */
export function agentSessionFile(topic: string): string | null {
  if (!topic) return null;
  const dir = config.agentSessionsDir;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const needle = topic.toLowerCase();
  const matches = names
    .filter((name) => name.endsWith('.jsonl') && name.toLowerCase().includes(needle))
    .map((name) => path.join(dir, name));
  if (matches.length === 0) return null;
  // A topic can gain a second file over time; the newest one is live.
  matches.sort((a, b) => statTime(b) - statTime(a));
  return matches[0] ?? null;
}

function statTime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Whole transcript, oldest first. Unparsable lines are skipped, not fatal. */
export async function readAgentRecords(file: string): Promise<AgentRecord[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: AgentRecord[] = [];
  for (const line of raw.split('\n')) {
    const record = parseLine(line);
    if (record) out.push(record);
  }
  return out;
}

function parseLine(line: string): AgentRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const role = String(value.role || '');
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') return null;
  const text = typeof value.content === 'string'
    ? value.content
    : value.content === undefined ? '' : JSON.stringify(value.content);
  return {
    role,
    text,
    name: typeof value.name === 'string' ? value.name : undefined,
    toolCallId: typeof value.tool_call_id === 'string' ? value.tool_call_id : undefined,
  };
}

/**
 * Follow a session file and report records appended after `fromOffset`.
 *
 * Returns the stop function. The watcher is deliberately simple: a change event
 * triggers a read from the last offset, complete lines are emitted, and a
 * trailing partial line waits for the next write. A file that shrinks was
 * rewritten, so the offset resets instead of reading garbage.
 */
export function tailAgentSession(
  file: string,
  options: {
    fromOffset?: number;
    onRecords: (records: AgentRecord[]) => void;
    onReset?: () => void;
  },
): { stop: () => void; offset: () => number } {
  let offset = options.fromOffset ?? 0;
  let partial = '';
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  const readAppended = async () => {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch {
      return;
    }
    if (stat.size < offset) {
      // Truncated or replaced: start over so the caller can resync.
      offset = 0;
      partial = '';
      options.onReset?.();
    }
    if (stat.size === offset) return;
    let handle: fsp.FileHandle;
    try {
      handle = await fsp.open(file, 'r');
    } catch {
      return;
    }
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      offset = stat.size;
      const text = partial + buffer.toString('utf8');
      const lines = text.split('\n');
      partial = lines.pop() ?? '';
      const records: AgentRecord[] = [];
      for (const line of lines) {
        const record = parseLine(line);
        if (record) records.push(record);
      }
      if (records.length) options.onRecords(records);
    } finally {
      await handle.close().catch(() => undefined);
    }
  };

  // Writes arrive in bursts; a short debounce keeps one read per burst.
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      queue = queue.then(readAppended).catch(() => undefined);
    }, 60);
  };

  const watcher = fs.watch(file, { persistent: false }, () => schedule());
  watcher.on('error', () => undefined);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
    offset: () => offset,
  };
}

/** One past the last newline, so a later tail starts on a clean record boundary. */
export async function endOfCompleteLines(file: string): Promise<number> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    return 0;
  }
  if (stat.size === 0) return 0;
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file, 'r');
  } catch {
    return 0;
  }
  try {
    const span = Math.min(stat.size, 64 * 1024);
    const buffer = Buffer.alloc(span);
    await handle.read(buffer, 0, span, stat.size - span);
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline === -1) return 0;
    return stat.size - span + lastNewline + 1;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Conversations the agent has on this machine, derived from its own files. */
export type LocalConversation = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
};

/** Topic id back out of a session file name.
 *
 * The agent names files after the surface (`cc_group_grp_123`,
 * `session_v2_catscompany_p2p_p2p_1_2_agent_usr2`), so the topic is the
 * trailing segment that starts with a known prefix.
 */
function topicFromName(name: string): string | null {
  const base = name.replace(/\.jsonl$/i, '');
  const match = /((?:grp|p2p)_[A-Za-z0-9_]+)$/.exec(base);
  if (match) return match[1]!.replace(/_agent_usr\d+$/, '');
  return null;
}

/** Read the newest file per topic, newest conversation first. */
export function listLocalConversations(limit = 60): LocalConversation[] {
  const dir = config.agentSessionsDir;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const byTopic = new Map<string, { file: string; mtime: number }>();
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const topic = topicFromName(name);
    if (!topic) continue;
    const file = path.join(dir, name);
    const mtime = statTime(file);
    const seen = byTopic.get(topic);
    if (!seen || mtime > seen.mtime) byTopic.set(topic, { file, mtime });
  }
  const out: LocalConversation[] = [];
  for (const [topic, entry] of byTopic) {
    out.push({ id: topic, title: '', preview: '', updatedAt: entry.mtime });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, limit);
}

/** Where the agent was working, which is what the CatsCo app files by.
 *
 * The state file keeps the session file's full name (`cc_group_grp_1.jsonl` →
 * `cc_group_grp_1.json`), not the bare topic, so derive it from the session.
 */
function sessionProject(sessionFile: string): string {
  const base = path.basename(sessionFile).replace(/\.jsonl$/i, '');
  const file = path.join(config.agentSessionsDir, '..', 'session-state', `${base}.json`);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { currentDirectory?: string };
    const dir = String(raw.currentDirectory || '');
    return dir ? path.basename(dir) : '';
  } catch {
    return '';
  }
}

/** A summary carried over from a previous model run is not a title. */
function isCarryOver(text: string): boolean {
  return /^Another language model started to solve this problem/i.test(text);
}

/** Title, preview and project for one conversation, read from its own file. */
export async function localConversationSummary(
  topic: string,
): Promise<{ title: string; preview: string; project: string }> {
  const file = agentSessionFile(topic);
  const project = file ? sessionProject(file) : '';
  if (!file) return { title: topic, preview: '', project };
  const records = await readAgentRecords(file);
  const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
  // Skip the transport envelope the CatsCo bridge puts in front of the text.
  const clean = (text: string) => oneLine(text.replace(/^\[发言人:[^\]]*\]\s*/, ''));
  const users = records.filter((item) => item.role === 'user').map((item) => clean(item.text));
  const lastAssistant = [...records].reverse().find((item) => item.role === 'assistant');
  const preview = lastAssistant ? clean(lastAssistant.text).slice(0, 120) : '';

  // The first real request names the conversation. Sessions that start with a
  // handoff preamble fall back to the latest request instead.
  let title = users.find((text, index) => text && (index > 0 || !isCarryOver(text))) ?? '';
  if (!title) title = users[users.length - 1] ?? topic;
  return { title: title.slice(0, 60) || topic, preview, project };
}
