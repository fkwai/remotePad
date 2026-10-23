import fs from 'node:fs/promises';
import { config } from './config.ts';

export type CatsCoChatTarget = {
  ready: boolean;
  reason?: string;
  dashboardUrl: string;
  appUrl: string;
  userUid: string;
  userName: string;
  botUid: string;
  botName: string;
  topicId: string;
};

export type CatsCoChatMessage = {
  id: number;
  fromUid: number;
  role: 'user' | 'assistant' | 'tool' | 'other';
  name?: string;
  text: string;
  createdAt?: string;
};

type DashStatus = {
  connected?: boolean;
  user?: { uid?: string; username?: string; display_name?: string };
  httpBaseUrl?: string;
};

type DashBots = {
  bots?: Array<{ uid?: string; username?: string; display_name?: string; isCurrent?: boolean }>;
  currentBotUid?: string;
};

function dashBase(): string {
  return config.catscoDashboardUrl.replace(/\/$/, '');
}

function p2pTopicId(uid1: string | number, uid2: string | number): string {
  const a = Number(uid1);
  const b = Number(uid2);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const [left, right] = a < b ? [a, b] : [b, a];
  return `p2p_${left}_${right}`;
}

async function dashGet<T>(path: string): Promise<T> {
  const res = await fetch(`${dashBase()}${path}`, { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(String((body as { error?: string }).error || `HTTP ${res.status}`));
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return body as T;
}

async function dashPost<T>(path: string, payload: unknown, timeoutMs = 20000): Promise<T> {
  const res = await fetch(`${dashBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(String((body as { error?: string }).error || `HTTP ${res.status}`));
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return body as T;
}

/** Resolve the user↔cloud-bot p2p topic via the running XiaoBa Dashboard. */
export async function resolveCatsCoChatTarget(): Promise<CatsCoChatTarget> {
  const dashboardUrl = dashBase();
  const base: CatsCoChatTarget = {
    ready: false,
    dashboardUrl,
    appUrl: 'https://app.catsco.cc',
    userUid: '',
    userName: '',
    botUid: '',
    botName: '',
    topicId: '',
  };
  try {
    const [status, bots] = await Promise.all([
      dashGet<DashStatus>('/api/cats/status'),
      dashGet<DashBots>('/api/cats/bots'),
    ]);
    const appUrl = String(status.httpBaseUrl || base.appUrl).replace(/\/$/, '') || base.appUrl;
    const userUid = String(status.user?.uid || '').trim();
    const userName = String(status.user?.display_name || status.user?.username || '').trim();
    const list = Array.isArray(bots.bots) ? bots.bots : [];
    const current = list.find((b) => b.isCurrent)
      || list.find((b) => String(b.uid) === String(bots.currentBotUid || ''))
      || list[0];
    const botUid = String(current?.uid || bots.currentBotUid || '').trim();
    const botName = String(current?.display_name || current?.username || botUid).trim();
    const topicId = userUid && botUid ? p2pTopicId(userUid, botUid) : '';
    if (!status.connected || !userUid) {
      return { ...base, appUrl, reason: 'CatsCo account not signed in on the Dashboard' };
    }
    if (!botUid || !topicId) {
      return {
        ...base,
        appUrl,
        userUid,
        userName,
        reason: 'No cloud Agent bound — open Dashboard and bind your CatsCo bot',
      };
    }
    return {
      ready: true,
      dashboardUrl,
      appUrl,
      userUid,
      userName,
      botUid,
      botName,
      topicId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, reason: `Dashboard unreachable (${message.split('\n')[0]})` };
  }
}

export async function fetchCatsCoMessages(
  topicId: string,
  userUid: string,
  limit = 80,
): Promise<CatsCoChatMessage[]> {
  const data = await dashGet<{ messages?: unknown[] }>(
    `/api/cats/messages?topic=${encodeURIComponent(topicId)}&limit=${limit}`,
  );
  const raw = Array.isArray(data.messages) ? data.messages : [];
  const uid = Number(userUid) || 0;
  const mapped = raw
    .map((item) => mapDashMessage(item, uid))
    .filter((item): item is CatsCoChatMessage => Boolean(item) && item!.text.trim() !== CANCEL_SENTINEL);
  mapped.sort((a, b) => a.id - b.id);
  // Pair each tool_use row with its following tool_result row: one row per step,
  // the same granularity the cloud app shows in its step list.
  const out: CatsCoChatMessage[] = [];
  for (const item of mapped) {
    const prev = out[out.length - 1];
    if (prev && prev.role === 'tool' && item.role === 'tool' && !prev.text.trim()) {
      out[out.length - 1] = {
        ...prev,
        name: prev.name === 'tool' ? item.name : prev.name,
        text: item.text,
      };
      continue;
    }
    out.push(item);
  }
  return out;
}

export async function sendCatsCoMessage(topicId: string, content: string): Promise<{ id: number }> {
  const data = await dashPost<{ id?: number; seq_id?: number }>(
    '/api/cats/messages/send',
    { topic_id: topicId, content },
  );
  const id = Number(data.id || data.seq_id || 0);
  if (!id) throw new Error('CatsCo send did not return a message id');
  return { id };
}

function mapDashMessage(raw: unknown, userUid: number): CatsCoChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const id = Number(msg.id || msg.seq_id || 0);
  if (!id) return null;
  const fromUid = Number(msg.from_uid || 0);
  const createdAt = typeof msg.created_at === 'string' ? msg.created_at : undefined;
  const blocks = Array.isArray(msg.content_blocks) ? msg.content_blocks as Record<string, unknown>[] : [];
  const toolResult = blocks.find((b) => b.type === 'tool_result');
  const toolUse = blocks.find((b) => b.type === 'tool_use');
  if (toolResult || toolUse) {
    // A step is stored as a tool_use row (name only) plus a tool_result row.
    // Reading tool_use as ordinary text turned every step into a chat line.
    const name = String(
      (toolUse as { name?: string } | undefined)?.name
      || (msg.metadata as { tool_name?: string } | undefined)?.tool_name
      || (toolResult as { name?: string } | undefined)?.name
      || 'tool',
    );
    const text = toolResult ? contentToText(toolResult.content ?? msg.content) : '';
    return { id, fromUid, role: 'tool', name, text, createdAt };
  }
  const text = contentToText(msg.content);
  if (!text.trim() && msg.msg_type === 'file') {
    const file = summarizeFile(msg.content);
    return {
      id,
      fromUid,
      role: fromUid === userUid ? 'user' : 'assistant',
      text: file || '[file]',
      createdAt,
    };
  }
  if (!text.trim()) return null;
  let role: CatsCoChatMessage['role'] = 'other';
  if (msg.role === 'assistant' || (fromUid && fromUid !== userUid)) role = 'assistant';
  if (msg.role === 'user' || fromUid === userUid) role = 'user';
  return { id, fromUid, role, text, createdAt };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: string }).text || '');
      return '';
    }).filter(Boolean).join('\n');
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (obj.type === 'file') return summarizeFile(content);
    try { return JSON.stringify(content); } catch { return String(content); }
  }
  return String(content);
}

function summarizeFile(content: unknown): string {
  if (!content || typeof content !== 'object') return '[file]';
  const obj = content as { payload?: { name?: string }; name?: string };
  const name = obj.payload?.name || obj.name;
  return name ? `[file: ${name}]` : '[file]';
}

export type CatsCoBot = {
  uid: string;
  name: string;
  username: string;
  isCurrent: boolean;
};

export type CatsCoProject = {
  id: number;
  name: string;
};

export type CatsCoConversation = {
  id: string;
  title: string;
  preview: string;
  projectId?: number;
  projectName?: string;
  isGroup: boolean;
  isTask: boolean;
  updatedAt?: number;
  /** Highest message seq seen by the cloud, used to detect new messages. */
  latestSeq?: number;
  /** Cloud task state: the agent is still working on this conversation. */
  working?: boolean;
  /** Cloud-provided progress text, e.g. "正在处理请求". */
  statusText?: string;
};

/** Bots owned by the signed-in CatsCo user. */
export async function listCatsCoBots(): Promise<CatsCoBot[]> {
  const data = await dashGet<{ bots?: Array<Record<string, unknown>> }>('/api/cats/bots');
  const list = Array.isArray(data.bots) ? data.bots : [];
  return list.map((bot) => {
    const uid = String(bot.uid || '');
    return {
      uid,
      name: String(bot.display_name || bot.username || uid),
      username: String(bot.username || ''),
      isCurrent: Boolean(bot.isCurrent),
    };
  }).filter((bot) => bot.uid);
}

/** Rebind the local connector to another bot. The Dashboard restarts it. */
export async function switchCatsCoBot(botUid: string): Promise<{ topicId?: string }> {
  const data = await dashPost<{ topicId?: string }>('/api/cats/switch-bot', { botUid }, 90000);
  return { topicId: data.topicId ? String(data.topicId) : undefined };
}

export async function listCatsCoProjects(): Promise<CatsCoProject[]> {
  const data = await dashGet<{ projects?: Array<Record<string, unknown>> }>('/api/cats/projects');
  const list = Array.isArray(data.projects) ? data.projects : [];
  return list.map((project) => ({
    id: Number(project.id ?? project.project_id ?? 0),
    name: String(project.name || ''),
  })).filter((project) => project.id > 0 && project.name);
}

export async function createCatsCoProject(name: string): Promise<CatsCoProject> {
  const data = await dashPost<{ project?: Record<string, unknown> }>('/api/cats/projects', { name });
  const project = data.project || {};
  return {
    id: Number(project.id ?? project.project_id ?? 0),
    name: String(project.name || name),
  };
}

/** Every conversation the account can see: p2p chats, groups, agent tasks. */
export async function listCatsCoConversations(): Promise<CatsCoConversation[]> {
  const data = await dashGet<{ conversations?: Array<Record<string, unknown>> }>('/api/cats/conversations');
  const list = Array.isArray(data.conversations) ? data.conversations : [];
  return list.map((item) => {
    const id = String(item.id || '');
    const projectId = Number(item.project_id ?? 0);
    const lastTime = typeof item.last_time === 'string' ? Date.parse(item.last_time) : NaN;
    const task = (item.task_status || {}) as { state?: string; summary?: string };
    const taskState = String(task.state || '').toLowerCase();
    return {
      id,
      title: String(item.name || id),
      preview: String(item.preview || '').replace(/\s+/g, ' ').slice(0, 120),
      projectId: projectId > 0 ? projectId : undefined,
      projectName: item.project_name ? String(item.project_name) : undefined,
      isGroup: Boolean(item.is_group),
      isTask: Boolean(item.is_agent_task),
      updatedAt: Number.isFinite(lastTime) ? lastTime : undefined,
      latestSeq: Number(item.latest_seq ?? 0) || undefined,
      working: taskState === 'running' || taskState === 'queued',
      statusText: task.summary ? String(task.summary) : undefined,
    };
  }).filter((item) => item.id);
}

/** Create an agent-task session (one bot) and optionally file it under a project. */
export async function createCatsCoTask(input: {
  name: string;
  projectId?: number;
  botUid?: string;
}): Promise<{ topicId: string; title: string }> {
  const data = await dashPost<{ topicId?: string; topic?: string; name?: string }>(
    '/api/cats/tasks',
    input,
    40000,
  );
  const topicId = String(data.topicId || data.topic || '');
  if (!topicId) throw new Error('CatsCo task creation did not return a topic');
  return { topicId, title: String(data.name || input.name) };
}

/** Where the cloud lives and which user we are: the dashboard owns that file. */
async function catsCloudAuth(): Promise<{ base: string; token: string } | null> {
  try {
    const cfg = await dashGet<{ configPath?: string }>('/api/cats/config');
    const raw = await fs.readFile(String(cfg.configPath || ''), 'utf8');
    const saved = JSON.parse(raw);
    const base = String(saved?.endpoints?.httpBaseUrl || '').replace(/\/$/, '');
    const token = String(saved?.account?.token || '').trim();
    return base && token ? { base, token } : null;
  } catch {
    return null;
  }
}

/**
 * Stop a cloud run. The connector watches for a lightweight `stream_cancel`
 * message on the topic and calls the same interrupt path as the web app's stop
 * button, so no extra API is needed. Nothing is added to the history.
 */
/** Body of the cancel control message. The server stores the row as plain text,
 *  so it is filtered out of every transcript instead of being shown to the user. */
export const CANCEL_SENTINEL = 'stream_cancel';

export async function cancelCatsCoRun(topicId: string): Promise<boolean> {
  if (!topicId) return false;
  const auth = await catsCloudAuth();
  if (!auth) return false;
  const res = await fetch(`${auth.base}/api/messages/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ topic_id: topicId, type: 'stream_cancel', content: CANCEL_SENTINEL }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}
