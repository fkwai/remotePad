import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { AgentChange, AgentHistoryItem, AgentServerMessage, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { HELPER_SESSION_ID } from '@remotepad/shared';
import { config } from '../config.ts';
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
  handleMessage: (text: string, callbacks: Record<string, unknown>) => Promise<{ text?: string }>;
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
    aiService: { getConfig: () => { model?: string; provider?: string } };
  };
  session: XiaobaSession;
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
  resolveRuntimeProfileFromConfig: (opts: Record<string, unknown>) => { profile: unknown };
  Logger?: { openLogFile?: (name: string, extra?: unknown, flag?: boolean) => void };
};

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
  const envFile = xiaobaEnvFile();
  process.env.DOTENV_CONFIG_PATH = envFile;
  applyDotenvFile(envFile);
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

function isSessionId(id: string): boolean {
  return id === HELPER_SESSION_ID || id === 'remotepad' || /^rp-[a-z0-9]+$/i.test(id);
}

function isHelperSession(id: string): boolean {
  return id === HELPER_SESSION_ID;
}

function ensureHelperMeta(meta = readMeta()): SessionMeta {
  if (!meta.ids.includes(HELPER_SESSION_ID)) meta.ids.unshift(HELPER_SESSION_ID);
  if (!meta.titles[HELPER_SESSION_ID]) meta.titles[HELPER_SESSION_ID] = 'Helper';
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

function composeHelperPrompt(base: string, latestUser: string): string {
  const brief = readAgentsBrief();
  const status = helperGitSnapshot();
  const latest = latestUser.trim();
  const parts = [
    base.trim(),
    brief ? `## RemotePad helper brief\n\n${brief}` : '## RemotePad helper brief\n\nYou edit only the RemotePad repo at the fixed cwd.',
    `## Helper process\n\nAGENTS.md is the product map. Chat JSONL is scratch (New task wipes it).\nXiaoBa summaries are fine for older work. The latest user message is the current job — if a summary disagrees about what to change, follow that message and AGENTS.md.`,
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
    if (!ids.includes(HELPER_SESSION_ID)) ids.unshift(HELPER_SESSION_ID);
    if (!titles[HELPER_SESSION_ID]) titles[HELPER_SESSION_ID] = 'Helper';
    return { id, titles, ids };
  } catch {
    return { id: '', titles: { [HELPER_SESSION_ID]: 'Helper' }, ids: [HELPER_SESSION_ID] };
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
  writeActiveSessionId(HELPER_SESSION_ID);
  return HELPER_SESSION_ID;
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

function readHistory(sessionId: string): AgentHistoryItem[] {
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
        tool_calls?: { name?: string }[];
      };
      if (msg.role === 'system') continue;
      const text = contentText(msg.content);
      if (msg.role === 'user') {
        if (isCheckpointUser(msg) || !text.trim()) continue;
        items.push({ role: 'user', text });
      } else if (msg.role === 'assistant') {
        if (text.trim()) items.push({ role: 'assistant', text });
        for (const call of msg.tool_calls || []) {
          if (call.name) items.push({ role: 'tool', name: call.name, text: '' });
        }
      } else if (msg.role === 'tool') {
        items.push({ role: 'tool', name: msg.name, text: text.slice(0, 800) });
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
  const fp = sessionFile(sessionId);
  let updatedAt = Date.now();
  let firstUser = '';
  let lastText = '';
  if (fs.existsSync(fp)) {
    try { updatedAt = fs.statSync(fp).mtimeMs; } catch { /* ignore */ }
    const raw = fs.readFileSync(fp, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as { role?: string; content?: unknown };
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        if (msg.role === 'user' && isCheckpointUser(msg)) continue;
        const text = contentText(msg.content).trim();
        if (!text) continue;
        if (msg.role === 'user' && !firstUser) firstUser = text;
        lastText = text;
      } catch {
        // skip bad line
      }
    }
  }
  const pinned = isHelperSession(sessionId);
  return {
    id: sessionId,
    title: clip(customTitle || (pinned ? 'Helper' : firstUser) || 'New session', 60),
    preview: clip(lastText, 80),
    updatedAt,
    pinned: pinned || undefined,
    historyPath: fp,
  };
}

function listSessions(currentId: string): AgentSessionInfo[] {
  const ids = new Set<string>([HELPER_SESSION_ID]);
  const dir = path.join(config.xiaobaDataDir, 'data', 'sessions');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (isSessionId(id)) ids.add(id);
    }
  }
  if (currentId && isSessionId(currentId)) ids.add(currentId);
  for (const id of readMeta().ids) ids.add(id);
  const titles = readMeta().titles;
  return [...ids]
    .map((id) => sessionInfo(id, titles[id]))
    .sort((a, b) => {
      if (a.id === HELPER_SESSION_ID) return -1;
      if (b.id === HELPER_SESSION_ID) return 1;
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
    const profile = loadFile('runtime/runtime-profile-config');
    const logger = (() => {
      try { return loadFile('utils/logger'); } catch { return {}; }
    })();
    logger.Logger?.openLogFile?.('remotepad', undefined, true);
    mods = {
      RuntimeFactory: factory.RuntimeFactory,
      resolveRuntimeProfileFromConfig: profile.resolveRuntimeProfileFromConfig,
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
      history: includeHistory && this.sessionId ? readHistory(this.sessionId) : undefined,
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

  private attachHelperPrompt(loaded: XiaobaMods, profile: unknown, bundle: XiaobaBundle): void {
    if (!isHelperSession(this.sessionId) || !bundle.session.setSystemPromptProvider) return;
    const baseProvider = loaded.RuntimeFactory.createSessionSystemPromptProvider?.(
      profile,
      this.sessionId,
      'cli',
    );
    bundle.session.setSystemPromptProvider(async () => {
      const base = baseProvider ? await baseProvider() : '';
      return composeHelperPrompt(typeof base === 'string' ? base : '', this.helperLastUser);
    });
  }

  async hello(cwd: string): Promise<void> {
    try {
      this.uiCwd = path.resolve(cwd || process.cwd());
      ensureHelperMeta();
      if (!this.sessionId) this.sessionId = readActiveSessionId();
      await this.ensureSession(this.resolveCwd());
      this.emitReady();
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
    const profile = loaded.resolveRuntimeProfileFromConfig({
      surface: 'cli',
      workingDirectory: next,
    }).profile;
    const bundle = await loaded.RuntimeFactory.createSession({
      profile,
      sessionKey: this.sessionId,
      sessionType: 'cli',
      loadSkills: false,
    });
    this.attachHelperPrompt(loaded, profile, bundle);
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
    if (isHelperSession(this.sessionId)) this.helperLastUser = message;
    if (this.sending || this.bundle?.session.isBusy()) {
      this.emit({ type: 'error', message: 'Agent is already running.' });
      return;
    }
    try {
      await this.ensureSession(this.resolveCwd());
      this.emitReady(this.cwd, false);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: text });
      return;
    }
    if (!this.bundle) {
      this.emit({ type: 'error', message: this.error || 'Agent is not ready.' });
      return;
    }
    const session = this.bundle.session;
    const cwd = this.cwd;
    this.sending = true;
    this.status = 'running';
    this.emit({ type: 'user', text: message });
    this.emit({ type: 'status', state: 'running' });
    await this.tracker.captureGitBaseline(cwd);
    const fileTools = new Set(['write_file', 'edit_file']);
    let lastWrite: string | null = null;
    let streamed = false;
    try {
      const result = await session.handleMessage(message, {
        onText: (chunk: string) => {
          if (chunk) {
            streamed = true;
            this.emit({ type: 'text', text: chunk });
          }
        },
        onToolStart: async (name: string, _id: string, input: unknown) => {
          this.emit({ type: 'tool_start', name, input });
          if (fileTools.has(name)) {
            lastWrite = toolPath(input as Record<string, unknown>, cwd);
          }
        },
        onToolEnd: async (name: string) => {
          this.emit({ type: 'tool_end', name, ok: true });
          if (fileTools.has(name) && lastWrite) {
            await this.tracker.refresh(lastWrite);
            this.emitChanges([lastWrite]);
          }
        },
        confirmToolExecution: async (request: ToolConfirmRequest) => {
          if (fileTools.has(request.toolName)) {
            const target = toolPath(request.args, request.workingDirectory || cwd);
            if (target) {
              lastWrite = target;
              await this.tracker.snapshotBeforeWrite(target);
            }
          }
          return { approved: true };
        },
      });
      if (!streamed && result?.text) this.emit({ type: 'text', text: result.text });
      await this.tracker.harvestGitExtras(cwd);
      this.emitChanges(this.tracker.list().map((item) => item.path));
      this.status = 'idle';
      this.emit({ type: 'status', state: 'idle' });
      this.emitSessions();
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.emit({ type: 'error', message: messageText });
      this.emit({ type: 'status', state: 'error', message: messageText });
      try {
        const extras = await this.tracker.harvestGitExtras(cwd);
        this.emitChanges(extras);
      } catch {
        // ignore
      }
    } finally {
      this.sending = false;
      if (this.status === 'running') {
        this.status = 'idle';
        this.emit({ type: 'status', state: 'idle' });
      }
    }
  }

  stop(): void {
    this.bundle?.session.requestInterrupt();
  }

  private async switchTo(id: string, restore: boolean): Promise<void> {
    this.bundle?.session.requestInterrupt();
    if (this.bundle?.session.cleanup) {
      try { await this.bundle.session.cleanup(); } catch { /* ignore */ }
    }
    this.bundle = null;
    this.sessionId = id;
    writeActiveSessionId(id);
    this.envStamp = '';
    try {
      await this.ensureSession(this.resolveCwd(), restore);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.status = 'idle';
    this.emitReady();
  }

  async newSession(): Promise<void> {
    await this.switchTo(newSessionId(), false);
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
    if (!isSessionId(id) || isHelperSession(id)) return;
    setSessionTitle(id, title);
    this.emitSessions();
  }

  async deleteSession(id: string): Promise<void> {
    if (!isSessionId(id)) return;
    if (isHelperSession(id)) {
      this.emit({ type: 'error', message: 'Helper session cannot be deleted.' });
      return;
    }
    const wasCurrent = id === this.sessionId;
    if (wasCurrent) {
      this.bundle?.session.requestInterrupt();
      if (this.bundle?.session.clear) this.bundle.session.clear();
      else this.bundle?.session.reset();
      this.bundle = null;
      this.envStamp = '';
    }
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
    const next = rest[0]?.id || HELPER_SESSION_ID;
    await this.switchTo(next, Boolean(rest[0]) || isHelperSession(next));
    this.emit({ type: 'status', state: 'idle', message: 'open' });
  }

  clear(): void {
    if (isHelperSession(this.sessionId)) this.helperLastUser = '';
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
