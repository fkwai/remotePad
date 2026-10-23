import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { AgentBackend, AgentChange, AgentHistoryItem, AgentServerMessage, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { isHelperSessionId } from '@remotepad/shared';
import { config } from '../config.ts';
import { applyLlmSettingsToEnv } from '../llm-settings.ts';
import {
  createCatsCoProject as createProjectApi,
  createCatsCoTask as createTaskApi,
  fetchCatsCoMessages,
  cancelCatsCoRun,
  listCatsCoBots,
  listCatsCoConversations,
  listCatsCoProjects,
  resolveCatsCoChatTarget,
  sendCatsCoMessage,
  switchCatsCoBot as switchBotApi,
  type CatsCoBot,
  type CatsCoConversation,
} from '../catsco-chat.ts';
import { ChangeTracker } from './changes.ts';
import { TurnSnapshot } from './turn-snapshot.ts';
import {
  agentSessionFile,
  endOfCompleteLines,
  listLocalConversations,
  localConversationSummary,
  readAgentRecords,
  tailAgentSession,
  type AgentRecord,
} from './agent-sessions.ts';
import {
  mergeCatsCoTranscript,
  readCatsCoTranscript,
  type StoredCatsCoMessage,
} from '../catsco-store.ts';

/** Local rows are emitted without the cloud id. */
function toHistoryItem(item: StoredCatsCoMessage): AgentHistoryItem {
  return { role: item.role, text: item.text, name: item.name };
}

/** Cloud row → local row. Roles are narrowed here, once. */
function toStoredRow(m: { id: number; role: string; text: string; name?: string }): StoredCatsCoMessage {
  return {
    id: Number(m.id),
    role: m.role === 'tool' ? 'tool' : m.role === 'user' ? 'user' : 'assistant',
    text: m.text,
    name: m.name,
  };
}
import {
  ensureHelperWorktree,
  helperWorktreePath,
  mergeHelperIntoMain,
  publishHelperWorktree,
  removeHelperWorktree,
  startHelperPreview,
} from './helper-worktree.ts';

type Listener = (msg: AgentServerMessage) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ToolConfirmRequest = {
  toolName: string;
  args?: Record<string, unknown>;
  risk?: string;
  reason?: string;
  workingDirectory?: string;
};

type SystemPromptProvider = () => Promise<string> | string;

type HandleMessageResult = {
  text?: string;
  visibleToUser?: boolean;
  taskOutcome?: 'completed' | 'failed' | 'cancelled';
};

type XiaobaSession = {
  handleMessage: (text: string, opts: Record<string, unknown>) => Promise<HandleMessageResult>;
  requestInterrupt: () => void;
  reset: () => void;
  clear?: () => boolean;
  restoreFromStore?: () => boolean;
  isBusy: () => boolean;
  cleanup?: () => Promise<void>;
  setSystemPromptProvider?: (provider: SystemPromptProvider) => void;
  setSkillReloadHandler?: (handler: () => Promise<void>) => void;
};

/** Match CatsCo: classify a returned turn when taskOutcome is missing. */
function turnOutcome(result: HandleMessageResult | undefined): 'completed' | 'failed' | 'cancelled' {
  if (result?.taskOutcome === 'failed' || result?.taskOutcome === 'cancelled' || result?.taskOutcome === 'completed') {
    return result.taskOutcome;
  }
  const text = String(result?.text || '');
  if (text.startsWith('已停止当前请求')) return 'cancelled';
  if (text.startsWith('处理消息时出错:')) return 'failed';
  return 'completed';
}

type XiaobaBundle = {
  profile: { skills: { enabled: boolean }; workingDirectory?: string };
  services: {
    skillManager: unknown;
    aiService: { getConfig: () => { model?: string; provider?: string; apiKey?: string } };
  };
  session: XiaobaSession;
};

type AdapterRuntimeBundle = {
  profile: XiaobaBundle['profile'] & Record<string, unknown>;
  services: XiaobaBundle['services'];
  sessionManagerOptions: {
    systemPromptProviderFactory?: (sessionKey: string) => SystemPromptProvider;
  };
  loadSkills: () => Promise<void>;
};

type XiaobaMods = {
  RuntimeFactory: {
    createSession: (opts: Record<string, unknown>) => Promise<XiaobaBundle>;
    loadSkills: (manager: unknown) => Promise<void>;
    createSessionSystemPromptProvider?: (
      profile: unknown,
      sessionKey: string,
      sessionType?: string,
    ) => SystemPromptProvider;
  };
  createAdapterRuntime: (opts: Record<string, unknown>) => AdapterRuntimeBundle;
  composeSessionSystemPromptProvider?: (
    base: SystemPromptProvider,
    context: { sessionKey: string; sessionType?: string },
  ) => SystemPromptProvider;
  Logger?: { openLogFile?: (name: string, extra?: unknown, flag?: boolean) => void };
};

/** Local single-user CatsCo-shaped turn identity (no cloud users / grants). */
function localCatscoTurn(sessionId: string): {
  executionScope: Record<string, unknown>;
  sessionRoute: Record<string, unknown>;
} {
  const topicId = sessionId;
  const actorUserId = 'local_user';
  const agentId = 'agent_self';
  const identity = {
    source: 'catscompany',
    topicId,
    topicType: 'p2p',
    actorUserId,
    agentId,
    identityTrust: 'legacy_context',
  };
  return {
    executionScope: {
      ...identity,
      sessionKey: sessionId,
      isTrusted: true,
    },
    sessionRoute: {
      version: 2,
      ...identity,
      sessionKey: sessionId,
      identity,
    },
  };
}

let mods: XiaobaMods | null = null;
let loadError: string | null = null;

const LLM_ENV_KEYS = [
  'GAUZ_LLM_PROVIDER',
  'GAUZ_LLM_API_BASE',
  'GAUZ_LLM_API_KEY',
  'GAUZ_LLM_MODEL',
  'GAUZ_LLM_OPENAI_API_MODE',
  'GAUZ_LLM_REASONING_EFFORT',
  'GAUZ_LLM_MAX_OUTPUT_TOKENS',
  'GAUZ_LLM_MAX_TOKENS',
  'GAUZ_LLM_CONTEXT_WINDOW_TOKENS',
  'GAUZ_LLM_CONTEXT_TOKENS',
];

function xiaobaEnvFile(): string {
  return path.join(config.xiaobaPath, '.env');
}

function applyDotenvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadXiaobaEnv(): void {
  fs.mkdirSync(config.xiaobaDataDir, { recursive: true });
  process.env.XIAOBA_USER_DATA_DIR = config.xiaobaDataDir;
  if (!process.env.CURRENT_PLATFORM) process.env.CURRENT_PLATFORM = 'catscompany';
  if (!process.env.CURRENT_AGENT_DISPLAY_NAME) process.env.CURRENT_AGENT_DISPLAY_NAME = 'RemotePad';
  const envFile = xiaobaEnvFile();
  process.env.DOTENV_CONFIG_PATH = envFile;
  applyDotenvFile(envFile);
  applyLlmSettingsToEnv();
}

function llmFingerprint(): string {
  return LLM_ENV_KEYS.map((key) => process.env[key] || '').join('\0');
}

const ACTIVE_SESSION_PATH = path.join(os.homedir(), '.remotepad', 'agent-active.json');
const BACKEND_PATH = path.join(os.homedir(), '.remotepad', 'agent-backend.json');
const CATSCO_SELECTION_PATH = path.join(os.homedir(), '.remotepad', 'catsco-selection.json');

/** Last CatsCo conversation the panel was on (topic id). */
function readCatsCoSelection(): { topicId: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(CATSCO_SELECTION_PATH, 'utf8')) as { topicId?: string };
    return { topicId: String(raw.topicId || '') };
  } catch {
    return { topicId: '' };
  }
}

function writeCatsCoSelection(value: { topicId: string }): void {
  try {
    fs.mkdirSync(path.dirname(CATSCO_SELECTION_PATH), { recursive: true });
    fs.writeFileSync(CATSCO_SELECTION_PATH, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  } catch { /* selection is a convenience, never fatal */ }
}

function readBackend(): AgentBackend {
  try {
    const raw = JSON.parse(fs.readFileSync(BACKEND_PATH, 'utf8')) as { backend?: string };
    return raw.backend === 'catsco' ? 'catsco' : 'local';
  } catch {
    return 'local';
  }
}

function writeBackend(backend: AgentBackend): void {
  fs.mkdirSync(path.dirname(BACKEND_PATH), { recursive: true });
  fs.writeFileSync(BACKEND_PATH, `${JSON.stringify({ backend }, null, 2)}\n`, { mode: 0o600 });
}

type SessionMeta = {
  id: string;
  titles: Record<string, string>;
  ids: string[];
};

function newSessionId(): string {
  return `rp-${Date.now().toString(36)}`;
}

function newHelperId(): string {
  return `helper-${Date.now().toString(36)}`;
}

function isSessionId(id: string): boolean {
  return id === 'remotepad' || isHelperSessionId(id) || /^rp-[a-z0-9]+$/i.test(id);
}

function isHelperSession(id: string): boolean {
  return isHelperSessionId(id);
}

function listHelperIdsOnDisk(): string[] {
  const dir = path.join(config.xiaobaDataDir, 'data', 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .filter((id) => isHelperSession(id));
}

function ensureHelperMeta(meta = readMeta()): SessionMeta {
  const helpers = [...new Set([...meta.ids.filter(isHelperSession), ...listHelperIdsOnDisk()])];
  if (helpers.length === 0) {
    const id = isHelperSession(meta.id) ? meta.id : newHelperId();
    if (!meta.ids.includes(id)) meta.ids.unshift(id);
  } else {
    for (const id of helpers) {
      if (!meta.ids.includes(id)) meta.ids.push(id);
    }
  }
  writeMeta(meta);
  return meta;
}

function readAgentsBrief(root = config.repoRoot): string {
  const fp = path.join(root, 'AGENTS.md');
  try {
    if (!fs.existsSync(fp)) return '';
    return fs.readFileSync(fp, 'utf8').trim();
  } catch {
    return '';
  }
}

function helperGitSnapshot(root: string): string {
  try {
    const status = execFileSync('git', ['-C', root, 'status', '--short', '--branch'], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 64 * 1024,
    }).trim();
    return status || '(clean)';
  } catch {
    return '(git status unavailable)';
  }
}

function isCheckpointUser(msg: { __checkpointSummary?: unknown; content?: unknown }): boolean {
  if (msg.__checkpointSummary === true) return true;
  const text = contentText(msg.content);
  return text.startsWith('Another language model started to solve') || text.includes('## Handoff summary');
}

const AGENT_LANGUAGE =
  '## Language\n\nReply in English. The user writes in English; always respond in English unless the user writes in another language. Do not reply in Chinese.';

function composeHelperPrompt(base: string, latestUser: string, worktree: string): string {
  const brief = readAgentsBrief(worktree) || readAgentsBrief(config.repoRoot);
  const status = helperGitSnapshot(worktree);
  const latest = latestUser.trim();
  const parts = [
    AGENT_LANGUAGE,
    base.trim(),
    brief ? `## RemotePad helper brief\n\n${brief}` : '## RemotePad helper brief\n\nYou edit only the Helper worktree.',
    `## Helper process\n\nYou work in a **git worktree**, not the live RemotePad install the user is running.\n- Worktree (your cwd — edit here only): ${worktree}\n- Live install (do **not** edit): ${config.repoRoot}\nAGENTS.md in the worktree is the product map. Chat JSONL is scratch. Refresh wipes this Helper chat.\nThe user publishes with **Commit & push** (Helper toolbar) when they want your branch on origin. Do not push yourself unless asked.\nTo try a preview: in the worktree run \`pnpm install\` once if needed, then \`pnpm dev\` (ports come from that tree's settings.json).\nXiaoBa summaries are fine for older work. The latest user message is the current job — if a summary disagrees, follow that message and AGENTS.md.`,
    latest ? `## Latest user message (verbatim)\n\n${latest}` : '',
    `## Worktree git status\n\n\`\`\`\n${status}\n\`\`\``,
  ];
  return parts.filter(Boolean).join('\n\n');
}

function sessionFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.xiaobaDataDir, 'data', 'sessions', `${safe}.jsonl`);
}

function sessionStateFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.xiaobaDataDir, 'data', 'session-state', `${safe}.json`);
}

function readMeta(): SessionMeta {
  try {
    const raw = JSON.parse(fs.readFileSync(ACTIVE_SESSION_PATH, 'utf8')) as {
      id?: string;
      titles?: Record<string, string>;
      ids?: string[];
    };
    const id = typeof raw.id === 'string' && isSessionId(raw.id) ? raw.id : '';
    const titles: Record<string, string> = {};
    if (raw.titles && typeof raw.titles === 'object') {
      for (const [key, value] of Object.entries(raw.titles)) {
        if (isSessionId(key) && typeof value === 'string' && value.trim()) titles[key] = value.trim().slice(0, 80);
      }
    }
    const ids = Array.isArray(raw.ids) ? raw.ids.filter((item) => typeof item === 'string' && isSessionId(item)) : [];
    if (id && !ids.includes(id)) ids.push(id);
    return { id, titles, ids };
  } catch {
    return { id: '', titles: {}, ids: [] };
  }
}

function writeMeta(meta: SessionMeta): void {
  fs.mkdirSync(path.dirname(ACTIVE_SESSION_PATH), { recursive: true });
  fs.writeFileSync(ACTIVE_SESSION_PATH, JSON.stringify({ id: meta.id, titles: meta.titles, ids: meta.ids }, null, 2));
}

function rememberSessionId(id: string, meta = readMeta()): SessionMeta {
  if (isSessionId(id) && !meta.ids.includes(id)) meta.ids.push(id);
  return meta;
}

function readActiveSessionId(): string {
  const meta = ensureHelperMeta(readMeta());
  if (meta.id) return meta.id;
  if (fs.existsSync(sessionFile('remotepad'))) {
    writeActiveSessionId('remotepad');
    return 'remotepad';
  }
  const helpers = listHelperIdsOnDisk();
  const fallback = helpers[0] || newHelperId();
  writeActiveSessionId(fallback);
  return fallback;
}

function writeActiveSessionId(id: string): void {
  const meta = rememberSessionId(id);
  meta.id = id;
  writeMeta(meta);
}

function setSessionTitle(id: string, title: string): void {
  const meta = readMeta();
  const next = title.trim().slice(0, 80);
  if (next) meta.titles[id] = next;
  else delete meta.titles[id];
  writeMeta(meta);
}

function unlinkSessionFiles(sessionId: string): void {
  for (const fp of [sessionFile(sessionId), sessionStateFile(sessionId)]) {
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ignore */ }
  }
  unlinkDisplayHistory(sessionId);
}

// Client transcript, same role as the CatsCo webapp chat store: only what was
// delivered to the panel. XiaoBa's session JSONL is the model context and is
// not copied here (it stubs tool results after hidden reasoning).
function displayHistoryFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.homedir(), '.remotepad', 'history', `${safe}.jsonl`);
}

function appendDisplayHistory(sessionId: string, item: AgentHistoryItem): void {
  if (!sessionId) return;
  if (!item.text && item.role !== 'tool') return;
  try {
    const fp = displayHistoryFile(sessionId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.appendFileSync(fp, JSON.stringify(item) + '\n');
  } catch { /* ignore */ }
}

function unlinkDisplayHistory(sessionId: string): void {
  try { fs.rmSync(displayHistoryFile(sessionId), { force: true }); } catch { /* ignore */ }
}

function readDisplayHistory(sessionId: string): AgentHistoryItem[] {
  const fp = displayHistoryFile(sessionId);
  if (!fs.existsSync(fp)) return [];
  const items: AgentHistoryItem[] = [];
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as AgentHistoryItem;
        if (item && typeof item.text === 'string' && (item.role === 'user' || item.role === 'assistant' || item.role === 'tool')) {
          items.push(item);
        }
      } catch { /* skip bad line */ }
    }
  } catch { /* ignore */ }
  return items.slice(-1000);
}

function readTranscriptHistory(sessionId: string, prints?: Map<string, string>): AgentHistoryItem[] {
  const display = readDisplayHistory(sessionId);
  if (display.length > 0) return display;
  return readHistory(sessionId, prints);
}

/** Client transcript when this panel has delivered turns; otherwise XiaoBa's context file. */
function transcriptPath(sessionId: string): string {
  const display = displayHistoryFile(sessionId);
  if (fs.existsSync(display)) return display;
  return sessionFile(sessionId);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as Record<string, unknown>;
      if (typeof rec.text === 'string') return rec.text;
      if (typeof rec.content === 'string') return rec.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

const TOOL_PRINT_MAX = 24_000;

function isStubbedToolPrint(text: string): boolean {
  return /历史工具结果已省略|历史输出已省略/.test(text);
}

function clipToolPrint(text: string, max = TOOL_PRINT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length} chars]`;
}

function readHistory(sessionId: string, prints?: Map<string, string>): AgentHistoryItem[] {
  const fp = sessionFile(sessionId);
  if (!fs.existsSync(fp)) return [];
  const items: AgentHistoryItem[] = [];
  const raw = fs.readFileSync(fp, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as {
        role?: string;
        content?: unknown;
        name?: string;
        tool_call_id?: string;
        tool_calls?: { name?: string }[];
      };
      if (msg.role === 'system') continue;
      const text = contentText(msg.content);
      if (msg.role === 'user') {
        if (isCheckpointUser(msg) || !text.trim()) continue;
        items.push({ role: 'user', text });
      } else if (msg.role === 'assistant') {
        if (text.trim()) items.push({ role: 'assistant', text });
      } else if (msg.role === 'tool') {
        const id = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
        const live = id ? prints?.get(`${sessionId}\0${id}`) : undefined;
        const body = live || (isStubbedToolPrint(text) ? '' : text);
        items.push({ role: 'tool', name: msg.name, text: clipToolPrint(body, 8000) });
      }
    } catch {
      // skip bad line
    }
  }
  return items.slice(-200);
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function sessionInfo(sessionId: string, customTitle?: string): AgentSessionInfo {
  const fp = transcriptPath(sessionId);
  let updatedAt = Date.now();
  let firstUser = '';
  let lastText = '';
  const items = readTranscriptHistory(sessionId);
  if (items.length > 0) {
    try { updatedAt = fs.statSync(fp).mtimeMs; } catch { /* ignore */ }
    for (const item of items) {
      if (item.role !== 'user' && item.role !== 'assistant') continue;
      const text = item.text.trim();
      if (!text) continue;
      if (item.role === 'user' && !firstUser) firstUser = text;
      lastText = text;
    }
  } else if (fs.existsSync(sessionFile(sessionId))) {
    try { updatedAt = fs.statSync(sessionFile(sessionId)).mtimeMs; } catch { /* ignore */ }
  }
  const named = customTitle && customTitle !== 'Helper' ? customTitle : '';
  const title = isHelperSession(sessionId) ? 'Helper' : (named || firstUser || 'New session');
  return {
    id: sessionId,
    title: clip(title, 60),
    preview: clip(lastText, 80),
    updatedAt,
    historyPath: fp,
  };
}

function listSessions(currentId: string): AgentSessionInfo[] {
  const ids = new Set<string>();
  const dir = path.join(config.xiaobaDataDir, 'data', 'sessions');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (isSessionId(id)) ids.add(id);
    }
  }
  if (currentId && isSessionId(currentId)) ids.add(currentId);
  for (const id of readMeta().ids) {
    if (isSessionId(id) && (id === currentId || fs.existsSync(sessionFile(id)))) ids.add(id);
  }
  const titles = readMeta().titles;
  return [...ids]
    .map((id) => sessionInfo(id, titles[id]))
    .sort((a, b) => {
      const ah = isHelperSession(a.id) ? 0 : 1;
      const bh = isHelperSession(b.id) ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return b.updatedAt - a.updatedAt;
    });
}

function loadMods(): XiaobaMods {
  if (mods) return mods;
  if (loadError) throw new Error(loadError);
  loadXiaobaEnv();
  const root = config.xiaobaPath;
  if (!fs.existsSync(root)) {
    loadError = `XiaoBa not found at ${root}. Set REMOTEPAD_XIAOBA_PATH.`;
    throw new Error(loadError);
  }
  const require = createRequire(path.join(root, 'package.json'));
  const loadFile = (rel: string) => {
    const dist = path.join(root, 'dist', `${rel}.js`);
    const src = path.join(root, 'src', `${rel}.ts`);
    if (fs.existsSync(dist)) return require(dist);
    if (fs.existsSync(src)) return require(src);
    throw new Error(`XiaoBa module missing: ${rel} (build XiaoBa-CLI or point REMOTEPAD_XIAOBA_PATH at a built install)`);
  };
  try {
    const factory = loadFile('runtime/runtime-factory');
    const adapter = loadFile('runtime/adapter-runtime');
    const sessionPrompt = (() => {
      try { return loadFile('core/session-system-prompt'); } catch { return {}; }
    })();
    const logger = (() => {
      try { return loadFile('utils/logger'); } catch { return {}; }
    })();
    logger.Logger?.openLogFile?.('remotepad', undefined, true);
    if (typeof adapter.createAdapterRuntime !== 'function') {
      throw new Error('XiaoBa createAdapterRuntime missing');
    }
    mods = {
      RuntimeFactory: factory.RuntimeFactory,
      createAdapterRuntime: adapter.createAdapterRuntime,
      composeSessionSystemPromptProvider: sessionPrompt.composeSessionSystemPromptProvider,
      Logger: logger.Logger,
    };
    return mods;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    throw new Error(loadError);
  }
}

/** Paths a tool call touched, read from the connector's args summary. */
function eventPaths(detail: string | undefined, cwd: string): string[] {
  if (!detail) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(detail) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const key of ['file_path', 'path', 'target']) {
    const raw = parsed[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

function toolPath(args: Record<string, unknown> | undefined, cwd: string): string | null {
  if (!args) return null;
  const raw = args.file_path ?? args.path ?? args.target;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
}

export class AgentHost {
  private listeners = new Set<Listener>();
  private bundle: XiaobaBundle | null = null;
  private cwd = '';
  private uiCwd = '';
  private model = '';
  private error: string | undefined;
  private status: AgentStatus = 'idle';
  private envStamp = '';
  private sessionId = '';
  private helperLastUser = '';
  private backend: AgentBackend = readBackend();
  /** Selected CatsCo conversation (topic). Empty = fall back to the bound bot's p2p. */
  private catscoTopic = readCatsCoSelection().topicId;
  /** Last list payload, reused by the cloud-state poller. */
  private catscoBots: CatsCoBot[] = [];
  private catscoProjects: Array<{ id: number; name: string }> = [];
  private catscoListTimer: ReturnType<typeof setInterval> | null = null;
  /** Identifies the newest send, so an abandoned turn cannot clear the flag. */
  private sendSeq = 0;
  /** Last cloud seq rendered, so the poller only redraws on real changes. */
  private catscoSeq = 0;
  /** Was the open turn running on the previous poll? Drives the single closing fetch. */
  private catscoWasWorking = false;
  /** Paths a tool call touched, kept from its start event until it ends. */
  private rpcPaths = new Map<string, string[]>();
  /** What the pane already shows, so an unchanged refresh stays silent. */
  private catscoEmitTopic = '';
  private catscoEmitSig = '';
  /** Seq whose last message is the bot's closing text: that turn is over, whatever
   *  the cloud still reports as the task state. Group topics otherwise stay
   *  "running" forever and the panel keeps offering Stop. */
  private catscoFinalSeq = 0;
  private catscoTitle = '';
  private catscoUserUid = '';
  /** One tracker per session: a file touched by one chat must not show in another. */
  private trackers = new Map<string, ChangeTracker>();
  /** What this turn started from; used when no tool event described the write. */
  private turnSnapshot = new TurnSnapshot();
  /** Live follower for the agent's own session file on this machine. */
  private agentTail: { stop: () => void } | null = null;
  private agentTailTopic = '';
  /** Quiet timer that decides a turn ended, with no network involved. */
  private agentSettle: NodeJS.Timeout | null = null;
  private sending = false;
  /** Bumped on every session switch so an in-flight send cannot touch the new tab. */
  private runGen = 0;
  /** Serializes ensureSession / cleanup so open and send cannot rebuild at once. */
  private sessionLock: Promise<void> = Promise.resolve();
  /** Live tool prints, keyed by `${sessionId}\\0${toolCallId}`, kept until that session is deleted. */
  private toolPrint = new Map<string, string>();

  /**
   * Abs path -> session id that made it dirty. A file belongs to the chat that
   * changed it first, so git harvest cannot leak it into another chat's list.
   */
  private owners = new Map<string, string>();

  /** Current session's change tracker (lazy). */
  private get tracker(): ChangeTracker {
    const id = this.sessionId || '_none';
    let item = this.trackers.get(id);
    if (!item) {
      item = new ChangeTracker();
      this.trackers.set(id, item);
    }
    return item;
  }

  private withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.sessionLock.then(fn, fn);
    this.sessionLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private isCurrentRun(gen: number, sessionId: string): boolean {
    return this.runGen === gen && this.sessionId === sessionId;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): {
    cwd: string;
    model?: string;
    error?: string;
    sessionId?: string;
    sessions: AgentSessionInfo[];
    changes: AgentChange[];
    state: AgentStatus;
    backend: AgentBackend;
  } {
    return {
      cwd: this.cwd,
      model: this.model || undefined,
      error: this.error,
      sessionId: this.sessionId || undefined,
      sessions: listSessions(this.sessionId),
      changes: this.tracker.list(),
      state: this.status,
      backend: this.backend,
    };
  }

  private emit(msg: AgentServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  private emitChanges(touched: string[] = []): void {
    this.emit({ type: 'changes', files: this.tracker.list(), touched });
  }

  private emitSessions(): void {
    this.emit({ type: 'sessions', sessions: listSessions(this.sessionId) });
  }

  private emitReady(cwd = this.cwd, includeHistory = true, history?: AgentHistoryItem[]): void {
    this.emit({
      type: 'ready',
      cwd,
      model: this.model || undefined,
      error: this.error,
      sessionId: this.sessionId || undefined,
      history: history ?? (includeHistory && this.sessionId && this.backend === 'local'
        ? readTranscriptHistory(this.sessionId, this.toolPrint)
        : undefined),
      sessions: listSessions(this.sessionId),
      changes: this.tracker.list(),
      backend: this.backend,
    });
  }

  private applyModel(cfg: { model?: string; provider?: string; apiKey?: string }): void {
    this.model = [cfg.provider, cfg.model].filter(Boolean).join('/') || cfg.model || '';
    if (!cfg.apiKey) {
      this.error = `No GAUZ_LLM_API_KEY. Add it to ${xiaobaEnvFile()} (the same file XiaoBa CLI reads).`;
    } else if (!cfg.model) {
      this.error = `No GAUZ_LLM_MODEL in ${xiaobaEnvFile()} or ~/.xiaoba/config.json.`;
    } else {
      this.error = undefined;
    }
  }

  private resolveCwd(): string {
    if (isHelperSession(this.sessionId)) {
      return path.resolve(helperWorktreePath(this.sessionId));
    }
    return path.resolve(this.uiCwd || process.cwd());
  }

  private attachSessionPrompt(
    loaded: XiaobaMods,
    bundle: XiaobaBundle,
    adapter: AdapterRuntimeBundle,
  ): void {
    // AgentSession defaults to SkillManager.loadSkills() (fail-fast). Bundled
    // XiaoBa skills (xiaoba-knowledge, catsco-prompt-editor) may be missing
    // from this checkout; that throw is classified as 模型服务暂时不稳定.
    // CatsCo's MessageSessionManager uses RuntimeFactory.loadSkills (warn).
    bundle.session.setSkillReloadHandler?.(() =>
      loaded.RuntimeFactory.loadSkills(bundle.services.skillManager),
    );
    if (!bundle.session.setSystemPromptProvider) return;
    const factory = adapter.sessionManagerOptions.systemPromptProviderFactory;
    let baseProvider: SystemPromptProvider | undefined;
    if (factory) {
      const inner = factory(this.sessionId);
      baseProvider = loaded.composeSessionSystemPromptProvider?.(inner, {
        sessionKey: this.sessionId,
        sessionType: 'catscompany',
      }) || inner;
    } else {
      baseProvider = loaded.RuntimeFactory.createSessionSystemPromptProvider?.(
        adapter.profile,
        this.sessionId,
        'catscompany',
      );
    }
    bundle.session.setSystemPromptProvider(async () => {
      const base = baseProvider ? await baseProvider() : '';
      if (isHelperSession(this.sessionId)) {
        return composeHelperPrompt(
          typeof base === 'string' ? base : '',
          this.helperLastUser,
          this.cwd || helperWorktreePath(this.sessionId),
        );
      }
      return `${AGENT_LANGUAGE}\n\n${typeof base === 'string' ? base : ''}`.trim();
    });
  }

  async hello(cwd: string, includeHistory = true): Promise<void> {
    try {
      this.uiCwd = path.resolve(cwd || process.cwd());
      ensureHelperMeta();
      if (!this.sessionId) this.sessionId = readActiveSessionId();
      if (this.backend === 'catsco') {
        // The "already emitted" gate is server-wide, but a reloaded page or a
        // second tab has shown nothing yet. Without this reset its first history
        // was suppressed and the pane stayed empty.
        if (includeHistory) this.catscoEmitTopic = '';
        await this.enterCatsCo(includeHistory);
        this.emit({ type: 'status', state: this.status });
        return;
      }
      await this.ensureSession(this.resolveCwd());
      this.emitReady(this.resolveCwd(), includeHistory);
      this.emit({ type: 'status', state: this.status });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.emitReady(this.resolveCwd());
    }
  }

  async setBackend(backend: AgentBackend): Promise<void> {
    if (backend !== 'local' && backend !== 'catsco') return;
    // Same backend click still reloads (CatsCo left list is easy to miss after a WS blip).
    if (this.backend === backend) {
      if (backend === 'catsco') await this.enterCatsCo(true);
      else {
        const history = this.sessionId
          ? readTranscriptHistory(this.sessionId, this.toolPrint)
          : [];
        this.emitReady(this.resolveCwd(), false, history);
        this.emit({ type: 'backend', backend: 'local', model: this.model || undefined });
      }
      return;
    }
    // Abandon any in-flight CatsCo poll / local turn. CatsCo chat is cloud-backed
    // (Dashboard messages), not a locked live session — Local must always be reachable.
    this.runGen += 1;
    const gen = this.runGen;
    this.sending = false;
    this.status = 'idle';
    this.bundle?.session.requestInterrupt();
    this.backend = backend;
    // The client drops its transcript when the backend changes, so the next
    // history emit must not be suppressed as "already shown".
    this.catscoEmitTopic = '';
    writeBackend(backend);
    this.error = undefined;
    this.emit({ type: 'status', state: 'idle', message: 'backend' });
    this.emit({
      type: 'backend',
      backend,
      model: backend === 'catsco' ? 'catsco/cloud' : (this.model || undefined),
    });
    if (backend === 'catsco') {
      await this.enterCatsCo(true, gen);
      return;
    }
    this.stopCatsCoListPoller();
    this.stopAgentTail();
    // Come back to Local with a rebuilt session so the kept tabs re-read their
    // transcript from disk instead of showing what they had before the switch.
    this.envStamp = '';
    await this.ensureSession(this.resolveCwd());
    if (this.runGen !== gen || this.backend !== 'local') return;
    // Always pass an array so the UI replaces CatsCo messages (undefined would keep them).
    const history = this.sessionId
      ? readTranscriptHistory(this.sessionId, this.toolPrint)
      : [];
    this.emitReady(this.resolveCwd(), false, history);
    this.emit({ type: 'backend', backend: 'local', model: this.model || undefined });
    this.emit({ type: 'status', state: 'idle', message: 'backend' });
  }

  /** Fold the turn's file changes in and publish the list. */
  private async applyTurnChanges(): Promise<void> {
    const changed = await this.turnSnapshot.finish().catch(() => []);
    const touched: string[] = [];
    for (const item of changed) {
      if (await this.tracker.trackWithOriginal(item.abs, item.before)) touched.push(item.abs);
    }
    this.emitChanges(touched.length ? touched : this.tracker.list().map((item) => item.path));
  }

  /** Push whatever the tools have touched. Nothing is discovered by scanning git:
   *  a dirty file may belong to another session or to the user. */
  private async harvestCatsCoChanges(): Promise<void> {
    this.emitChanges(this.tracker.list().map((item) => item.path));
  }

  /** Redraw the open conversation when the cloud wrote new messages.
   *
   * Without this the panel only moved when remotePad itself sent: a task started
   * from the CatsCo app, or the closing message of any turn, never appeared.
   */
  /** One cheap probe decides whether anything is new: the newest message id.
   *
   * History lives locally, so a sync appends a few rows or does nothing.
   * Re-rendering the whole transcript on every tick was the churn.
   */
  private async syncCatsCoTranscript(force = false): Promise<{ changed: boolean }> {
    const topic = this.catscoTopic;
    if (!topic || this.sending) return { changed: false };
    const stored = readCatsCoTranscript(topic);
    try {
      const newest = await fetchCatsCoMessages(topic, this.catscoUserUid, 1);
      if (this.backend !== 'catsco' || this.sending) return { changed: false };
      const newestId = Number(newest[newest.length - 1]?.id || 0);
      if (!force && stored && newestId && newestId === stored.lastId) return { changed: false };
      const window = newestId && stored && newestId !== stored.lastId
        ? await fetchCatsCoMessages(topic, this.catscoUserUid, 60)
        : newest;
      if (this.backend !== 'catsco' || this.sending) return { changed: false };
      const rows: StoredCatsCoMessage[] = window
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        .map(toStoredRow)
        .filter((m) => Number.isFinite(m.id) && m.id > 0);
      const merged = mergeCatsCoTranscript(topic, rows);
      const tail = merged.messages[merged.messages.length - 1];
      this.catscoFinalSeq = tail && tail.role === 'assistant' && tail.text.trim() ? tail.id : 0;
      if (merged.changed) {
        this.emitReady(this.resolveCwd(), false, this.historyForEmit(topic, merged.messages));
      }
      return { changed: merged.changed };
    } catch {
      // A failed sync keeps whatever is on screen.
      return { changed: false };
    }
  }

  /** The connector pushed an event: react now instead of on the next tick. */
  async ingestCatsCoEvent(event: {
    kind?: string;
    topic?: string;
    requestId?: string;
    phase?: 'start' | 'end';
    tool?: string;
    ok?: boolean;
    detail?: string;
  }): Promise<void> {
    if (this.backend !== 'catsco') return;
    if (event.kind === 'tool') {
      // Files the call touched. This runs even while our own turn is in flight:
      // the panel's step list already streams from the transcript, but the change
      // list has no other source, so skipping here lost every edit.
      // The end event carries no args, so the paths are remembered by request id.
      const rpcKey = event.requestId || '';
      const paths = event.phase === 'start'
        ? eventPaths(event.detail, this.uiCwd || this.resolveCwd())
        : (this.rpcPaths.get(rpcKey) ?? []);
      if (event.phase === 'start') {
        if (rpcKey) this.rpcPaths.set(rpcKey, paths);
        for (const item of paths) await this.tracker.snapshotBeforeWrite(item);
      } else {
        if (rpcKey) this.rpcPaths.delete(rpcKey);
        for (const item of paths) await this.tracker.refresh(item);
        if (paths.length) this.emitChanges(paths);
      }
      // Steps for a turn this panel started already stream from its own loop.
      if (this.sending) return;
      const id = `catsco-rpc-${event.requestId || Date.now()}`;
      const name = event.tool || 'tool';
      if (event.phase === 'start') {
        this.catscoWasWorking = true;
        if (this.status !== 'running') {
          this.status = 'running';
          this.emit({ type: 'status', state: 'running' });
        }
        this.emit({ type: 'tool_start', name, id });
      } else {
        this.emit({ type: 'tool_end', name, id, ok: event.ok !== false, result: event.detail || '' });
      }
      return;
    }
    if (event.kind === 'message') {
      // Covered by the step stream; pulling here would duplicate the turn.
      return;
    }
    void this.pollCatsCoState().catch(() => undefined);
  }

  /** Follow the agent's session file for this conversation.
   *
   * Returns false when this topic has no file here (the agent runs elsewhere),
   * so the caller keeps the Dashboard path for that case.
   */
  private async startAgentTail(topicId: string): Promise<boolean> {
    if (this.agentTail && this.agentTailTopic === topicId) return true;
    this.stopAgentTail();
    if (!topicId) return false;
    const file = agentSessionFile(topicId);
    if (!file) return false;

    const records = await readAgentRecords(file);
    if (this.backend !== 'catsco') return false;
    const history: AgentHistoryItem[] = records.map((item) => ({
      role: item.role,
      text: item.text,
      name: item.name,
    }));
    const tailRecord = records[records.length - 1];
    this.agentTailTopic = topicId;
    this.emitReady(this.resolveCwd(), false, history);

    // Follow only what is written from now on; the history above covers the rest.
    const offset = await endOfCompleteLines(file);
    this.agentTail = tailAgentSession(file, {
      fromOffset: offset,
      onRecords: (batch) => this.onAgentRecords(topicId, batch),
      onReset: () => { this.agentTailTopic = ''; },
    });
    if (tailRecord && tailRecord.role === 'tool' && !this.sending) {
      this.status = 'running';
      this.emit({ type: 'status', state: 'running' });
    }
    return true;
  }

  private stopAgentTail(): void {
    if (this.agentSettle) {
      clearTimeout(this.agentSettle);
      this.agentSettle = null;
    }
    this.agentTail?.stop();
    this.agentTail = null;
    this.agentTailTopic = '';
  }

  /** Turn appended records into panel events. File order is the turn order. */
  private onAgentRecords(topicId: string, records: AgentRecord[]): void {
    if (this.backend !== 'catsco' || this.agentTailTopic !== topicId) return;
    if (this.agentSettle) {
      clearTimeout(this.agentSettle);
      this.agentSettle = null;
    }
    for (const record of records) {
      if (record.role === 'tool') {
        // A tool row is written when the call finished, so it arrives complete.
        const id = `file-${record.toolCallId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
        this.emit({ type: 'tool_start', name: record.name || 'tool', id });
        this.emit({ type: 'tool_end', name: record.name || 'tool', id, ok: true, result: record.text });
        if (this.status !== 'running' && !this.sending) {
          this.status = 'running';
          this.emit({ type: 'status', state: 'running' });
        }
        continue;
      }
      if (record.role === 'user') {
        // Our own send already put this on screen.
        if (this.sending) continue;
        this.emit({ type: 'text', text: record.text.endsWith('\n') ? record.text : `${record.text}\n` });
        continue;
      }
      this.emit({ type: 'text', text: record.text.endsWith('\n') ? record.text : `${record.text}\n` });
    }

    // The turn is over once the file stops growing and the last word was the
    // agent's. Waiting for quiet also covers assistant text written between tools.
    const last = records[records.length - 1];
    if (last && last.role !== 'tool') {
      this.agentSettle = setTimeout(() => {
        this.agentSettle = null;
        if (this.agentTailTopic !== topicId) return;
        if (this.status === 'running') {
          this.status = 'idle';
          this.emit({ type: 'status', state: 'idle', message: 'session-file' });
        }
      }, 2000);
      this.agentSettle.unref?.();
    }
  }

  /** Poll the cloud task state so the panel can disable Send while the agent runs. */
  private startCatsCoListPoller(): void {
    if (this.catscoListTimer) return;
    this.catscoListTimer = setInterval(() => { void this.pollCatsCoState(); }, 2500);
    this.catscoListTimer.unref?.();
  }

  private stopCatsCoListPoller(): void {
    if (!this.catscoListTimer) return;
    clearInterval(this.catscoListTimer);
    this.catscoListTimer = null;
  }

  private async pollCatsCoState(): Promise<void> {
    if (this.backend !== 'catsco') {
      this.stopCatsCoListPoller();
      return;
    }
    try {
      const conversations = await listCatsCoConversations();
      if (this.backend !== 'catsco') return;
      // Self-heal a turn that was abandoned mid-flight (topic switch, dropped
      // poll): if the cloud says the task is done and we are not sending, the
      // panel must not stay locked on "working" forever.
      const raw = conversations.find((item) => item.id === this.catscoTopic);
      const cloudWorking = Boolean(raw?.working);
      // While a turn runs, steps arrive from the connector, so pulling the whole
      // transcript every tick is the churn we set out to remove. Once it stops,
      // one sync brings the closing text — before anything is judged.
      const justFinished = this.catscoWasWorking && !cloudWorking;
      const justStarted = !this.catscoWasWorking && cloudWorking;
      this.catscoWasWorking = cloudWorking;
      // A turn started from the CatsCo app never passes through send(): take the
      // baseline here so its edits are still attributed to this conversation.
      if (justStarted) await this.turnSnapshot.capture(this.uiCwd || this.resolveCwd());
      if (justFinished) await this.applyTurnChanges();
      if (!cloudWorking && !this.agentTail) await this.syncCatsCoTranscript(justFinished);
      if (cloudWorking) await this.harvestCatsCoChanges().catch(() => undefined);

      const settled = this.settleTurn(conversations);
      const active = settled.find((item) => item.id === this.catscoTopic);
      if (!this.sending && this.status === 'running' && active && active.working === false) {
        this.status = 'idle';
        this.emit({ type: 'status', state: 'idle', message: 'cloud' });
      }
      this.emitCatsCoList(
        this.catscoBots,
        this.catscoProjects,
        conversations,
        this.catscoTopic,
        this.error,
      );
    } catch {
      // Keep the last known list; a Dashboard blip must not empty the panel.
    }
  }

  /** Decide whether the pane needs this history at all.
   *
   * Refresh is meant to be cheap: same conversation, same last message, so the
   * client keeps what it has and nothing re-renders.
   */
  private historyForEmit(topic: string, rows: StoredCatsCoMessage[]): AgentHistoryItem[] | undefined {
    const sig = `${rows.length}:${rows.length ? rows[rows.length - 1]!.id : 0}`;
    if (topic === this.catscoEmitTopic && sig === this.catscoEmitSig) return undefined;
    this.catscoEmitTopic = topic;
    this.catscoEmitSig = sig;
    return rows.map(toHistoryItem);
  }

  /** A turn whose closing text already landed is not running any more. */
  private settleTurn(conversations: CatsCoConversation[]): CatsCoConversation[] {
    if (!this.catscoFinalSeq || !this.catscoTopic) return conversations;
    return conversations.map((item) => (
      item.id === this.catscoTopic
        && Number(item.latestSeq || 0) >= this.catscoFinalSeq
        && item.working
        ? { ...item, working: false, statusText: '任务已完成' }
        : item
    ));
  }

  private emitCatsCoList(
    bots: CatsCoBot[],
    projects: Array<{ id: number; name: string }>,
    conversations: CatsCoConversation[],
    topicId: string,
    listError?: string,
  ): void {
    const settled = this.settleTurn(conversations);
    this.emit({
      type: 'catsco_list',
      bots: bots.map((bot) => ({ uid: bot.uid, name: bot.name, isCurrent: bot.isCurrent })),
      projects,
      conversations: settled,
      topicId: topicId || undefined,
      userUid: this.catscoUserUid || undefined,
      ready: Boolean(topicId),
      error: listError || this.error,
    });
  }

  private stillCatsCo(gen?: number): boolean {
    if (this.backend !== 'catsco') return false;
    if (gen !== undefined && this.runGen !== gen) return false;
    return true;
  }

  private async enterCatsCo(includeHistory: boolean, gen = this.runGen): Promise<void> {
    if (!this.stillCatsCo(gen)) return;
    const target = await resolveCatsCoChatTarget();
    if (!this.stillCatsCo(gen)) return;
    this.catscoUserUid = target.userUid || this.catscoUserUid;
    // Do not emit an empty list first — the UI treats undefined as Loading and an
    // empty emit looks like "No bots / No projects" and can trigger refresh loops.

    const settled = await Promise.allSettled([
      listCatsCoBots(),
      listCatsCoProjects(),
      listCatsCoConversations(),
    ]);
    if (!this.stillCatsCo(gen)) return;
    const bots = settled[0].status === 'fulfilled' ? settled[0].value : [] as CatsCoBot[];
    const projects = settled[1].status === 'fulfilled' ? settled[1].value : [] as Array<{ id: number; name: string }>;
    this.catscoBots = bots;
    this.catscoProjects = projects;
    // The agent's own files describe its conversations. When the Dashboard is
    // down (or absent, as on the machine that runs the agent) this is the whole
    // list — no HTTP, and it cannot disagree with what the panel then reads.
    let conversations: CatsCoConversation[] = settled[2].status === 'fulfilled'
      ? settled[2].value
      : [];
    if (conversations.length === 0) {
      const local = listLocalConversations();
      const summaries = await Promise.all(
        local.map(async (item) => ({ item, ...(await localConversationSummary(item.id)) })),
      );
      conversations = summaries.map(({ item, title, preview }) => ({
        id: item.id,
        title,
        preview,
        isGroup: item.id.startsWith('grp_'),
        isTask: false,
        updatedAt: item.updatedAt,
        working: false,
      }));
    }
    if (!this.stillCatsCo(gen)) return;
    const listFails = settled
      .map((item, i) => {
        if (item.status !== 'rejected') return '';
        const label = i === 0 ? 'bots' : i === 1 ? 'projects' : 'conversations';
        const reason = item.reason instanceof Error ? item.reason.message : String(item.reason);
        return `${label}: ${reason}`;
      })
      .filter(Boolean);
    const listError = listFails.length
      ? `CatsCo list failed (${listFails.join('; ')}). Is Dashboard on ${config.catscoDashboardUrl}?`
      : undefined;

    const known = new Set(conversations.map((item) => item.id));
    const saved = this.catscoTopic && known.has(this.catscoTopic) ? this.catscoTopic : '';
    const topicId = saved
      || (target.topicId && (known.size === 0 || known.has(target.topicId)) ? target.topicId : '')
      || conversations[0]?.id
      || '';
    // Without a Dashboard there is no bot identity, but the agent's files still
    // name every conversation it has here, so the panel stays usable.
    const hasLocalFiles = !target.ready && listLocalConversations(1).length > 0;
    if (!target.ready && !topicId && !hasLocalFiles) {
      if (!this.stillCatsCo(gen)) return;
      this.error = target.reason || listError || 'CatsCo cloud chat is not ready';
      this.model = 'catsco/cloud';
      this.emitCatsCoList(bots, projects, conversations, '', this.error);
      this.emitReady(this.resolveCwd(), false, []);
      this.emit({ type: 'backend', backend: 'catsco', model: this.model, error: this.error });
      return;
    }
    this.error = listError;
    this.catscoTopic = topicId;
    if (topicId) writeCatsCoSelection({ topicId });
    const current = conversations.find((item) => item.id === topicId);
    this.catscoTitle = current?.title || '';
    this.catscoSeq = Number(current?.latestSeq || 0);
    this.model = `catsco/${this.catscoTitle || target.botName || target.botUid || 'cloud'}`;
    let history: AgentHistoryItem[] | undefined;
    let catscoRows: StoredCatsCoMessage[] | undefined;
    // On this machine the agent writes its own session file: read it, follow it,
    // and skip the Dashboard round trips for the transcript.
    const tailing = includeHistory && topicId ? await this.startAgentTail(topicId) : false;
    if (includeHistory && topicId && !tailing) {
      // Show the local copy immediately; the network only fills the gap.
      const cached = readCatsCoTranscript(topicId);
      if (cached && cached.messages.length) {
        const tail = cached.messages[cached.messages.length - 1];
        this.catscoFinalSeq = tail && tail.role === 'assistant' && tail.text.trim() ? tail.id : 0;
        catscoRows = cached.messages;
        // Paint from disk now. Opening used to wait for the network round trips
        // below even though the conversation was already stored locally.
        this.emitCatsCoList(bots, projects, conversations, topicId, this.error);
        this.emitReady(this.resolveCwd(), false, this.historyForEmit(topicId, catscoRows));
        this.emit({ type: 'backend', backend: 'catsco', model: this.model, error: this.error });
      }
      try {
        const newest = await fetchCatsCoMessages(topicId, this.catscoUserUid, 1);
        if (!this.stillCatsCo(gen)) return;
        const newestId = Number(newest[newest.length - 1]?.id || 0);
        if (!cached || (newestId && newestId !== cached.lastId)) {
          const window = await fetchCatsCoMessages(topicId, this.catscoUserUid, 60);
          if (!this.stillCatsCo(gen)) return;
          const rows: StoredCatsCoMessage[] = window
            .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
            .map(toStoredRow)
            .filter((m) => Number.isFinite(m.id) && m.id > 0);
          const merged = mergeCatsCoTranscript(topicId, rows);
          const tail = merged.messages[merged.messages.length - 1];
          this.catscoFinalSeq = tail && tail.role === 'assistant' && tail.text.trim() ? tail.id : 0;
          catscoRows = merged.messages;
        }
      } catch (err) {
        if (!this.stillCatsCo(gen)) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.error = this.error ? `${this.error}; history: ${msg}` : msg;
        // Keep whatever is on screen: an empty array here blanked the window.
        history = undefined;
      }
      if (catscoRows) history = this.historyForEmit(topicId, catscoRows);
    }
    if (!this.stillCatsCo(gen)) return;
    this.emitCatsCoList(bots, projects, conversations, topicId, listError);
    // When tailing, startAgentTail already emitted this conversation's history.
    if (!tailing) this.emitReady(this.resolveCwd(), false, history);
    this.emit({ type: 'backend', backend: 'catsco', model: this.model, error: this.error });
    // Don't clobber Working… if a CatsCo poll is mid-flight (list refresh).
    if (!this.sending) this.emit({ type: 'status', state: 'idle', message: 'backend' });
    this.startCatsCoListPoller();
  }

  /** Left list: open another conversation (p2p chat, group, or agent task). */
  async selectCatsCoTopic(topicId: string): Promise<void> {
    const id = topicId.trim();
    if (!id || this.backend !== 'catsco') return;
    this.runGen += 1;
    this.sending = false;
    this.status = 'idle';
    this.catscoTopic = id;
    writeCatsCoSelection({ topicId: id });
    await this.enterCatsCo(true);
  }

  async refreshCatsCo(): Promise<void> {
    if (this.backend !== 'catsco') return;
    await this.enterCatsCo(true);
  }

  async createCatsCoProject(name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    try {
      await createProjectApi(clean);
      await this.enterCatsCo(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message });
    }
  }

  async createCatsCoTask(name: string, projectId?: number): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    try {
      const created = await createTaskApi({ name: clean, projectId });
      this.catscoTopic = created.topicId;
      writeCatsCoSelection({ topicId: created.topicId });
      await this.enterCatsCo(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message });
    }
  }

  async switchCatsCoBot(botUid: string): Promise<void> {
    const uid = botUid.trim();
    if (!uid) return;
    try {
      const result = await switchBotApi(uid);
      this.catscoTopic = result.topicId || '';
      if (this.catscoTopic) writeCatsCoSelection({ topicId: this.catscoTopic });
      await this.enterCatsCo(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message });
    }
  }

  async ensureSession(cwd: string, restore = true): Promise<void> {
    loadXiaobaEnv();
    ensureHelperMeta();
    if (!this.sessionId) this.sessionId = readActiveSessionId();
    let next: string;
    if (isHelperSession(this.sessionId)) {
      const wt = await ensureHelperWorktree(this.sessionId);
      next = path.resolve(wt.path);
    } else {
      next = path.resolve(cwd || this.uiCwd || process.cwd());
    }
    const stamp = llmFingerprint();
    if (this.bundle && this.cwd === next && this.envStamp === stamp) return;
    if (this.bundle?.session.cleanup) {
      try { await this.bundle.session.cleanup(); } catch { /* ignore */ }
    }
    this.bundle = null;
    this.cwd = next;
    this.envStamp = stamp;
    this.error = undefined;
    const loaded = loadMods();
    // Same knobs as CatsCo's createCatsCompanyRuntime — local, no cloud bot.
    const adapter = loaded.createAdapterRuntime({
      surface: 'catscompany',
      workingDirectory: next,
      promptSnapshotMode: 'mutable-identity',
    });
    const bundle = await loaded.RuntimeFactory.createSession({
      profile: adapter.profile,
      sessionKey: this.sessionId,
      sessionType: 'catscompany',
      loadSkills: false,
    });
    this.attachSessionPrompt(loaded, bundle, adapter);
    if (restore) bundle.session.restoreFromStore?.();
    if (bundle.profile.skills.enabled) {
      await loaded.RuntimeFactory.loadSkills(bundle.services.skillManager);
    }
    this.applyModel(bundle.services.aiService.getConfig());
    this.bundle = bundle;
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    if (this.backend === 'catsco') {
      await this.sendCatsCo(message);
      return;
    }
    const gen = this.runGen;
    const sid = this.sessionId;
    if (isHelperSession(sid)) this.helperLastUser = message;
    if (this.sending || this.bundle?.session.isBusy()) {
      this.emit({ type: 'error', message: 'Agent is already running.' });
      return;
    }
    this.sending = true;
    const sendToken = ++this.sendSeq;
    this.status = 'running';
    let cwd = this.cwd;
    // Flush each spoken segment before the next tool so the history file keeps
    // Agent text and the real tool print in the order they happened. XiaoBa's
    // own session file later replaces those prints with a stub.
    let pending = '';
    const flushAssistant = () => {
      const text = pending.trim();
      pending = '';
      if (!text) return;
      appendDisplayHistory(sid, { role: 'assistant', text });
    };
    try {
      const session = await this.withSessionLock(async () => {
        if (!this.isCurrentRun(gen, sid)) return null;
        await this.ensureSession(this.resolveCwd());
        if (!this.isCurrentRun(gen, sid) || !this.bundle) return null;
        cwd = this.cwd;
        return this.bundle.session;
      });
      if (!this.isCurrentRun(gen, sid)) return;
      if (!session) {
        this.emit({ type: 'error', message: this.error || 'Agent is not ready.' });
        return;
      }
      this.emitReady(cwd, false);
      // Persist the user turn immediately, the way CatsCo delivers it to the client.
      // XiaoBa still rewrites its own session file at end of turn.
      appendDisplayHistory(sid, { role: 'user', text: message });
      this.emit({ type: 'user', text: message });
      this.emit({ type: 'status', state: 'running' });
      this.emitSessions();
      // Baseline for files no tool hook describes (shell edits, scripts).
      await this.turnSnapshot.capture(cwd);
      const fileTools = new Set(['write_file', 'edit_file']);
      let lastWrite: string | null = null;
      // All assistant text already shown this turn (survives tool flushes). Used so
      // CatsCo-style final result.text still lands when it is a *new* notice
      // (max_tokens / stop) but is skipped when it would duplicate a streamed answer.
      let spoken = '';
      const mine = () => this.isCurrentRun(gen, sid);
      const deliverVisibleReply = (reply: string) => {
        const text = reply.trim();
        if (!text) return;
        if (pending.includes(text) || spoken.includes(text)) {
          flushAssistant();
          return;
        }
        const chunk = spoken || pending.trim() ? `\n${text}` : text;
        pending = pending.trim() ? `${pending}\n${text}` : text;
        spoken += chunk;
        if (mine()) this.emit({ type: 'text', text: chunk });
        flushAssistant();
      };
      const turn = localCatscoTurn(sid);
      const result = await session.handleMessage(message, {
        ...turn,
        callbacks: {
          onText: (chunk: string) => {
            if (!chunk) return;
            pending += chunk;
            spoken += chunk;
            if (!mine()) return;
            this.emit({ type: 'text', text: chunk });
          },
          onThinking: async (thinking: string) => {
            // Compaction / progress notices (CatsCo sendThinking). Show in the panel
            // so context-full compress does not look like a silent hang.
            const text = String(thinking || '').trim();
            if (!text || !mine()) return;
            flushAssistant();
            appendDisplayHistory(sid, { role: 'assistant', text });
            spoken += `\n${text}`;
            this.emit({ type: 'text', text: `${text}\n` });
          },
          onToolStart: async (name: string, id: string, input: unknown) => {
            flushAssistant();
            if (!mine()) return;
            this.emit({ type: 'tool_start', name, id, input });
            // Snapshot here: catscompany skips confirmToolExecution, so the
            // confirm hook never runs. onToolStart fires before the write.
            if (fileTools.has(name)) {
              lastWrite = toolPath(input as Record<string, unknown>, cwd);
              if (lastWrite) await this.tracker.snapshotBeforeWrite(lastWrite);
            }
          },
          onToolEnd: async (name: string, id: string, result: string) => {
            const print = clipToolPrint(typeof result === 'string' ? result : '');
            if (id && print && !isStubbedToolPrint(print)) {
              this.toolPrint.set(`${sid}\0${id}`, print);
            }
            appendDisplayHistory(sid, { role: 'tool', name, text: print });
            if (!mine()) return;
            this.emit({ type: 'tool_end', name, id, ok: true, result: print });
            if (fileTools.has(name) && lastWrite) {
              await this.tracker.refresh(lastWrite);
              if (mine()) this.emitChanges([lastWrite]);
            }
          },
          confirmToolExecution: async (request: ToolConfirmRequest) => {
            if (!mine()) return { approved: false };
            if (fileTools.has(request.toolName)) {
              const target = toolPath(request.args, request.workingDirectory || cwd);
              if (target) {
                lastWrite = target;
                await this.tracker.snapshotBeforeWrite(target);
              }
            }
            return { approved: true };
          },
        },
      });
      if (!mine()) {
        flushAssistant();
        return;
      }
      // CatsCo always delivers visibleToUser result.text into the chat, including
      // cancel/fail/max_tokens notices after a partial stream. Do not go idle silently.
      const outcome = turnOutcome(result);
      const reply = typeof result?.text === 'string' ? result.text.trim() : '';
      const showReply = Boolean(reply) && result?.visibleToUser !== false;
      if (outcome === 'failed') {
        const notice = showReply ? reply : 'Agent turn failed.';
        deliverVisibleReply(notice);
        this.status = 'error';
        // One chat line + error banner (same role as CatsCo's visible failure reply).
        this.emit({ type: 'error', message: notice });
        this.emit({ type: 'status', state: 'error', message: notice });
      } else if (outcome === 'cancelled') {
        const notice = showReply ? reply : 'Stopped.';
        if (showReply) deliverVisibleReply(notice);
        else this.emit({ type: 'error', message: notice });
        this.status = 'idle';
        this.emit({ type: 'status', state: 'idle', message: 'stopped' });
      } else {
        if (showReply) deliverVisibleReply(reply);
        else flushAssistant();
        this.status = 'idle';
        this.emit({ type: 'status', state: 'idle' });
      }
      if (!mine()) return;
      await this.applyTurnChanges();
      this.emitSessions();
    } catch (err) {
      flushAssistant();
      if (!this.isCurrentRun(gen, sid)) return;
      const messageText = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.emit({ type: 'error', message: messageText });
      this.emit({ type: 'status', state: 'error', message: messageText });
      if (this.isCurrentRun(gen, sid)) await this.applyTurnChanges();
    } finally {
      flushAssistant();
      // Release the lock for the newest send only. A turn abandoned by a session
      // switch must not leave `sending` stuck, which used to block Send and hide
      // Stop for every session afterwards.
      if (this.sendSeq === sendToken) {
        this.sending = false;
        if (this.runGen === gen && this.status === 'running') {
          this.status = 'idle';
          this.emit({ type: 'status', state: 'idle' });
        }
      }
    }
  }

  private async sendCatsCo(message: string): Promise<void> {
    const gen = this.runGen;
    if (this.sending) {
      this.emit({ type: 'error', message: 'Agent is already running.' });
      return;
    }
    this.sending = true;
    const sendToken = ++this.sendSeq;
    this.status = 'running';
    const mine = () => this.runGen === gen && this.backend === 'catsco';
    try {
      const target = await resolveCatsCoChatTarget();
      if (!mine()) return;
      if (!target.ready) {
        this.error = target.reason || 'CatsCo cloud chat is not ready';
        this.emit({ type: 'error', message: this.error });
        this.status = 'error';
        this.emit({ type: 'status', state: 'error', message: this.error });
        return;
      }
      const topicId = this.catscoTopic || target.topicId;
      if (!topicId) {
        this.error = target.reason || 'No CatsCo conversation selected';
        this.emit({ type: 'error', message: this.error });
        this.status = 'error';
        this.emit({ type: 'status', state: 'error', message: this.error });
        return;
      }
      this.catscoTopic = topicId;
      this.catscoUserUid = target.userUid || this.catscoUserUid;
      // Tool events cover hook-described writes; this covers everything else.
      const trackCwd = this.uiCwd || this.resolveCwd();
      await this.turnSnapshot.capture(trackCwd);
      this.model = `catsco/${this.catscoTitle || target.botName || target.botUid}`;
      this.error = undefined;
      this.emit({ type: 'user', text: message });
      this.emit({ type: 'status', state: 'running' });
      const sent = await sendCatsCoMessage(topicId, message);
      if (!mine()) return;
      const userUid = Number(this.catscoUserUid) || 0;
      let lastId = sent.id;
      const emittedTools = new Set<number>();
      // After a step the bot goes quiet while it composes the answer; ending on
      // quiet alone cut the turn off before that answer arrived.
      let awaitingAnswer = false;
      let quietSince = Date.now();
      let sawBot = false;
      const started = Date.now();
      const QUIET_MS = 3_000;
      // A step can be left without a result row; never wait on it forever.
      const STALE_MS = 90_000;
      const MAX_MS = 12 * 60_000;
      let polls = 0;
      while (mine() && Date.now() - started < MAX_MS) {
        if (polls > 0) await sleep(700);
        polls += 1;
        if (!mine()) return;
        let msgs;
        try {
          msgs = await fetchCatsCoMessages(topicId, this.catscoUserUid, 40);
        } catch (err) {
          if (!mine()) return;
          const text = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'error', message: text });
          break;
        }
        for (const msg of msgs) {
          if (msg.fromUid === userUid || msg.role === 'user') continue;
          // A step lands as tool_use (name, no output) and later tool_result under
          // the same id. Start it once, then fill in the output — never as two rows
          // and never as plain chat text.
          if (msg.role === 'tool') {
            awaitingAnswer = true;
            const stepId = `catsco-${msg.id}`;
            const hasOutput = Boolean(msg.text.trim());
            if (!hasOutput && msg.id <= lastId) continue;
            if (hasOutput && emittedTools.has(msg.id)) continue;
            lastId = Math.max(lastId, msg.id);
            this.emit({ type: 'tool_start', name: msg.name || 'tool', id: stepId });
            if (hasOutput) {
              emittedTools.add(msg.id);
              this.emit({ type: 'tool_end', name: msg.name || 'tool', id: stepId, ok: true, result: msg.text });
            }
            sawBot = true;
            quietSince = Date.now();
            continue;
          }
          if (msg.id <= lastId) continue;
          lastId = msg.id;
          this.emit({ type: 'text', text: msg.text.endsWith('\n') ? msg.text : `${msg.text}\n` });
          awaitingAnswer = false;
          sawBot = true;
          quietSince = Date.now();
        }
        const quietFor = Date.now() - quietSince;
        if (sawBot && quietFor >= QUIET_MS && (!awaitingAnswer || quietFor >= STALE_MS)) break;
      }
      if (!mine()) return;
      await this.applyTurnChanges();
      await this.harvestCatsCoChanges();
      this.status = 'idle';
      this.emit({ type: 'status', state: 'idle' });
    } catch (err) {
      if (!mine()) return;
      await this.harvestCatsCoChanges().catch(() => undefined);
      const messageText = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.emit({ type: 'error', message: messageText });
      this.emit({ type: 'status', state: 'error', message: messageText });
    } finally {
      if (this.sendSeq === sendToken) {
        this.sending = false;
        if (this.runGen === gen && this.status === 'running') {
          this.status = 'idle';
          this.emit({ type: 'status', state: 'idle' });
        }
      }
      // The turn is over: fold it into the local copy and emit only the new
      // rows, so what you typed is followed by whatever the agent added.
      await this.syncCatsCoTranscript().catch(() => undefined);
    }
  }

  stop(): void {
    // Same abandon as tab-switch: bump runGen so the in-flight send drops, then
    // interrupt XiaoBa. Only requestInterrupt() left the UI on Working until the
    // provider abort finished (often tens of seconds) — Stop looked broken.
    const live = this.status === 'running' || this.sending || Boolean(this.bundle?.session.isBusy());
    this.runGen += 1;
    this.sending = false;
    this.status = 'idle';
    // CatsCo text arrives as cloud messages. A local notice would inject a line the
    // cloud never saw, and interrupting the (local) bundle wiped the session that
    // is still on screen — that is how Stop emptied the window.
    if (this.backend === 'catsco') {
      const topic = this.catscoTopic;
      this.emit({ type: 'status', state: 'idle', message: 'stopped' });
      // The run lives in the cloud, so Stop has to reach it: the connector treats
      // a stream_cancel message as the web app's stop button.
      if (live && topic) {
        void cancelCatsCoRun(topic).then((ok) => {
          if (!ok) this.emit({ type: 'error', message: 'Could not reach CatsCo to cancel this run.' });
          void this.pollCatsCoState();
        }).catch(() => undefined);
      }
      return;
    }
    this.bundle?.session.requestInterrupt();
    if (live) {
      const notice = '已停止当前请求。';
      appendDisplayHistory(this.sessionId, { role: 'assistant', text: notice });
      this.emit({ type: 'text', text: notice });
    }
    this.emit({ type: 'status', state: 'idle', message: 'stopped' });
  }

  /** Next message rebuilds the XiaoBa session so a saved model/key is picked up. */
  dropLlmCache(): void {
    this.envStamp = '';
  }

  private async switchTo(id: string, restore: boolean): Promise<void> {
    // Drop any in-flight send before touching the bundle. WS handlers are not serialized.
    this.runGen += 1;
    this.sending = false;
    this.status = 'idle';
    this.bundle?.session.requestInterrupt();
    await this.withSessionLock(async () => {
      const prev = this.bundle;
      this.bundle = null;
      if (prev?.session.cleanup) {
        try { await prev.session.cleanup(); } catch { /* ignore */ }
      }
      this.sessionId = id;
      writeActiveSessionId(id);
      this.envStamp = '';
      try {
        await this.ensureSession(this.resolveCwd(), restore);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
    });
    this.status = 'idle';
    this.emitReady();
  }

  async newSession(helper = false): Promise<void> {
    if (helper) this.helperLastUser = '';
    await this.switchTo(helper ? newHelperId() : newSessionId(), false);
    this.emit({ type: 'status', state: 'idle', message: 'new' });
  }

  async openSession(id: string): Promise<void> {
    if (!isSessionId(id)) {
      this.emit({ type: 'error', message: 'Unknown session.' });
      return;
    }
    if (id === this.sessionId) {
      // Clicking the tab that is already active must still reload it. Returning
      // early left an empty pane, and only going to another tab and back fixed it.
      await this.ensureSession(this.resolveCwd());
      this.emitReady();
      return;
    }
    await this.switchTo(id, true);
    this.emit({ type: 'status', state: 'idle', message: 'open' });
  }

  renameSession(id: string, title: string): void {
    if (!isSessionId(id)) return;
    setSessionTitle(id, title);
    this.emitSessions();
  }

  async deleteSession(id: string): Promise<void> {
    if (!isSessionId(id)) return;
    const wasCurrent = id === this.sessionId;
    if (wasCurrent) {
      this.bundle?.session.requestInterrupt();
      if (this.bundle?.session.clear) this.bundle.session.clear();
      else this.bundle?.session.reset();
      this.bundle = null;
      this.envStamp = '';
    }
    this.forgetToolPrints(id);
    this.trackers.delete(id);
    unlinkSessionFiles(id);
    if (isHelperSession(id)) {
      await removeHelperWorktree(id).catch(() => undefined);
    }
    const meta = readMeta();
    delete meta.titles[id];
    meta.ids = meta.ids.filter((item) => item !== id);
    writeMeta(meta);
    if (!wasCurrent) {
      this.emitSessions();
      return;
    }
    const rest = listSessions('').filter((item) => item.id !== id);
    const next = rest.find((item) => isHelperSession(item.id))?.id || rest[0]?.id || newHelperId();
    await this.switchTo(next, rest.some((item) => item.id === next));
    this.emit({ type: 'status', state: 'idle', message: 'open' });
  }

  private forgetToolPrints(sessionId: string): void {
    const prefix = `${sessionId}\0`;
    for (const key of [...this.toolPrint.keys()]) {
      if (key.startsWith(prefix)) this.toolPrint.delete(key);
    }
  }

  clear(): void {
    if (this.backend === 'catsco') {
      void this.enterCatsCo(true);
      return;
    }
    if (isHelperSession(this.sessionId)) this.helperLastUser = '';
    this.forgetToolPrints(this.sessionId);
    unlinkDisplayHistory(this.sessionId);
    this.bundle?.session.requestInterrupt();
    if (this.bundle?.session.clear) this.bundle.session.clear();
    else this.bundle?.session.reset();
    this.status = 'idle';
    this.emitReady();
    this.emit({ type: 'status', state: 'idle', message: 'cleared' });
  }

  async accept(filePath: string): Promise<void> {
    const touched = await this.tracker.accept(filePath);
    this.emitChanges(touched);
  }

  async undo(filePath: string): Promise<void> {
    const touched = await this.tracker.undo(filePath);
    this.emitChanges(touched);
  }

  async acceptAll(): Promise<void> {
    const touched = await this.tracker.acceptAll();
    this.emitChanges(touched);
  }

  async undoAll(): Promise<void> {
    const touched = await this.tracker.undoAll();
    this.emitChanges(touched);
  }

  /** One-key: commit worktree changes and push helper/* branch to origin. */
  async publish(): Promise<void> {
    if (!isHelperSession(this.sessionId)) {
      this.emit({ type: 'error', message: 'Commit & push is only for Helper sessions.' });
      return;
    }
    const sid = this.sessionId;
    try {
      const result = await publishHelperWorktree(sid);
      if (result.ok) {
        this.emit({ type: 'text', text: result.message, sessionId: sid });
      } else {
        this.emit({ type: 'error', message: result.message, sessionId: sid });
      }
    } catch (err) {
      this.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        sessionId: sid,
      });
    }
  }

  /** Helper only: start the worktree instance on the preview ports. */
  async preview(): Promise<void> {
    if (!isHelperSession(this.sessionId)) {
      this.emit({ type: 'error', message: 'Preview is only for Helper sessions.' });
      return;
    }
    const sid = this.sessionId;
    this.emit({ type: 'status', state: this.status, message: 'starting preview', sessionId: sid });
    try {
      const result = await startHelperPreview(sid);
      this.emit({ type: result.ok ? 'text' : 'error', ...(result.ok ? { text: result.message } : { message: result.message }), sessionId: sid } as AgentServerMessage);
    } catch (err) {
      this.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        sessionId: sid,
      });
    }
  }

  /** Helper only: merge the worktree into main, delete trees, stop the preview. */
  async merge(): Promise<void> {
    if (!isHelperSession(this.sessionId)) {
      this.emit({ type: 'error', message: 'Merge is only for Helper sessions.' });
      return;
    }
    const sid = this.sessionId;
    try {
      const result = await mergeHelperIntoMain(sid);
      if (result.ok) {
        // The worktree is gone: force the next turn to recreate it from main.
        this.cwd = '';
        this.envStamp = '';
        this.emit({ type: 'text', text: result.message, sessionId: sid });
      } else {
        this.emit({ type: 'error', message: result.message, sessionId: sid });
      }
    } catch (err) {
      this.emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        sessionId: sid,
      });
    }
  }
}

export const agentHost = new AgentHost();
