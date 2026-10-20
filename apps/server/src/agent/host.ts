import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { AgentChange, AgentHistoryItem, AgentServerMessage, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { isHelperSessionId } from '@remotepad/shared';
import { config } from '../config.ts';
import { applyLlmSettingsToEnv } from '../llm-settings.ts';
import { ChangeTracker } from './changes.ts';

type Listener = (msg: AgentServerMessage) => void;

type ToolConfirmRequest = {
  toolName: string;
  args?: Record<string, unknown>;
  risk?: string;
  reason?: string;
  workingDirectory?: string;
};

type SystemPromptProvider = () => Promise<string> | string;

type XiaobaSession = {
  handleMessage: (text: string, opts: Record<string, unknown>) => Promise<{ text?: string }>;
  requestInterrupt: () => void;
  reset: () => void;
  clear?: () => boolean;
  restoreFromStore?: () => boolean;
  isBusy: () => boolean;
  cleanup?: () => Promise<void>;
  setSystemPromptProvider?: (provider: SystemPromptProvider) => void;
};

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

function readAgentsBrief(): string {
  const fp = path.join(config.repoRoot, 'AGENTS.md');
  try {
    if (!fs.existsSync(fp)) return '';
    return fs.readFileSync(fp, 'utf8').trim();
  } catch {
    return '';
  }
}

function helperGitSnapshot(): string {
  const root = config.repoRoot;
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

function composeHelperPrompt(base: string, latestUser: string): string {
  const brief = readAgentsBrief();
  const status = helperGitSnapshot();
  const latest = latestUser.trim();
  const parts = [
    AGENT_LANGUAGE,
    base.trim(),
    brief ? `## RemotePad helper brief\n\n${brief}` : '## RemotePad helper brief\n\nYou edit only the RemotePad repo at the fixed cwd.',
    `## Helper process\n\nAGENTS.md is the product map. Chat JSONL is scratch. Refresh wipes this Helper chat; lasting work already lives in git and AGENTS.md.\nXiaoBa summaries are fine for older work. The latest user message is the current job — if a summary disagrees about what to change, follow that message and AGENTS.md.`,
    latest ? `## Latest user message (verbatim)\n\n${latest}` : '',
    `## Live repo status\n\nRepo: ${config.repoRoot}\n\`\`\`\n${status}\n\`\`\``,
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

// RemotePad keeps its own append-only transcript so the Agent panel keeps the
// user-visible history even when XiaoBa compacts the session JSONL (which
// replaces older messages with a checkpoint summary and skips them on read).
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

// On the first round of an existing session, copy what XiaoBa already persisted
// into our append-only transcript so we don't drop older turns when we switch
// the panel over to reading this file. XiaoBa's own JSONL is left untouched.
function seedDisplayHistory(sessionId: string): void {
  if (!sessionId) return;
  const fp = displayHistoryFile(sessionId);
  if (fs.existsSync(fp)) return;
  const items = readHistory(sessionId);
  if (items.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, items.map((item) => JSON.stringify(item)).join('\n') + '\n');
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
  seedDisplayHistory(sessionId);
  const display = readDisplayHistory(sessionId);
  if (display.length > 0) return display;
  return readHistory(sessionId, prints);
}

/** Prefer the append-only panel transcript; fall back to XiaoBa's compactable context file. */
function transcriptPath(sessionId: string): string {
  seedDisplayHistory(sessionId);
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
  readonly tracker = new ChangeTracker();
  private sending = false;
  /** Bumped on every session switch so an in-flight send cannot touch the new tab. */
  private runGen = 0;
  /** Serializes ensureSession / cleanup so open and send cannot rebuild at once. */
  private sessionLock: Promise<void> = Promise.resolve();
  /** Live tool prints, keyed by `${sessionId}\\0${toolCallId}`, kept until that session is deleted. */
  private toolPrint = new Map<string, string>();

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

  snapshot(): { cwd: string; model?: string; error?: string; sessionId?: string; sessions: AgentSessionInfo[]; changes: AgentChange[]; state: AgentStatus } {
    return {
      cwd: this.cwd,
      model: this.model || undefined,
      error: this.error,
      sessionId: this.sessionId || undefined,
      sessions: listSessions(this.sessionId),
      changes: this.tracker.list(),
      state: this.status,
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

  private emitReady(cwd = this.cwd, includeHistory = true): void {
    this.emit({
      type: 'ready',
      cwd,
      model: this.model || undefined,
      error: this.error,
      sessionId: this.sessionId || undefined,
      history: includeHistory && this.sessionId ? readTranscriptHistory(this.sessionId, this.toolPrint) : undefined,
      sessions: listSessions(this.sessionId),
      changes: this.tracker.list(),
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
    if (isHelperSession(this.sessionId)) return path.resolve(config.repoRoot);
    return path.resolve(this.uiCwd || process.cwd());
  }

  private attachSessionPrompt(
    loaded: XiaobaMods,
    bundle: XiaobaBundle,
    adapter: AdapterRuntimeBundle,
  ): void {
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
        return composeHelperPrompt(typeof base === 'string' ? base : '', this.helperLastUser);
      }
      return `${AGENT_LANGUAGE}\n\n${typeof base === 'string' ? base : ''}`.trim();
    });
  }

  async hello(cwd: string, includeHistory = true): Promise<void> {
    try {
      this.uiCwd = path.resolve(cwd || process.cwd());
      ensureHelperMeta();
      if (!this.sessionId) this.sessionId = readActiveSessionId();
      await this.ensureSession(this.resolveCwd());
      this.emitReady(this.resolveCwd(), includeHistory);
      this.emit({ type: 'status', state: this.status });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.emitReady(this.resolveCwd());
    }
  }

  async ensureSession(cwd: string, restore = true): Promise<void> {
    loadXiaobaEnv();
    ensureHelperMeta();
    if (!this.sessionId) this.sessionId = readActiveSessionId();
    const next = isHelperSession(this.sessionId)
      ? path.resolve(config.repoRoot)
      : path.resolve(cwd || this.uiCwd || process.cwd());
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
    seedDisplayHistory(this.sessionId);
    if (bundle.profile.skills.enabled) {
      await adapter.loadSkills();
    }
    this.applyModel(bundle.services.aiService.getConfig());
    this.bundle = bundle;
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    const gen = this.runGen;
    const sid = this.sessionId;
    if (isHelperSession(sid)) this.helperLastUser = message;
    if (this.sending || this.bundle?.session.isBusy()) {
      this.emit({ type: 'error', message: 'Agent is already running.' });
      return;
    }
    this.sending = true;
    this.status = 'running';
    let cwd = this.cwd;
    let assistant = '';
    let assistantSaved = false;
    const saveAssistant = () => {
      if (assistantSaved || !assistant.trim()) return;
      appendDisplayHistory(sid, { role: 'assistant', text: assistant });
      assistantSaved = true;
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
      // Persist the user turn immediately. XiaoBa's own JSONL only rewrites at
      // end-of-turn (or interrupt), and compaction can replace older lines.
      seedDisplayHistory(sid);
      appendDisplayHistory(sid, { role: 'user', text: message });
      this.emit({ type: 'user', text: message });
      this.emit({ type: 'status', state: 'running' });
      this.emitSessions();
      await this.tracker.captureGitBaseline(cwd);
      const fileTools = new Set(['write_file', 'edit_file']);
      let lastWrite: string | null = null;
      let streamed = false;
      const mine = () => this.isCurrentRun(gen, sid);
      const turn = localCatscoTurn(sid);
      const result = await session.handleMessage(message, {
        ...turn,
        callbacks: {
          onText: (chunk: string) => {
            if (!chunk) return;
            assistant += chunk;
            if (!mine()) return;
            streamed = true;
            this.emit({ type: 'text', text: chunk });
          },
          onToolStart: async (name: string, id: string, input: unknown) => {
            if (!mine()) return;
            this.emit({ type: 'tool_start', name, id, input });
            if (fileTools.has(name)) {
              lastWrite = toolPath(input as Record<string, unknown>, cwd);
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
      if (!streamed && result?.text) {
        assistant = result.text;
        if (mine()) this.emit({ type: 'text', text: result.text });
      }
      saveAssistant();
      if (!mine()) return;
      await this.tracker.harvestGitExtras(cwd);
      if (!mine()) return;
      this.emitChanges(this.tracker.list().map((item) => item.path));
      this.status = 'idle';
      this.emit({ type: 'status', state: 'idle' });
      this.emitSessions();
    } catch (err) {
      saveAssistant();
      if (!this.isCurrentRun(gen, sid)) return;
      const messageText = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.emit({ type: 'error', message: messageText });
      this.emit({ type: 'status', state: 'error', message: messageText });
      try {
        const extras = await this.tracker.harvestGitExtras(cwd);
        if (this.isCurrentRun(gen, sid)) this.emitChanges(extras);
      } catch {
        // ignore
      }
    } finally {
      saveAssistant();
      if (this.runGen === gen) {
        this.sending = false;
        if (this.status === 'running') {
          this.status = 'idle';
          this.emit({ type: 'status', state: 'idle' });
        }
      }
    }
  }

  stop(): void {
    this.bundle?.session.requestInterrupt();
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
    if (id === this.sessionId) return;
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
    unlinkSessionFiles(id);
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
}

export const agentHost = new AgentHost();
