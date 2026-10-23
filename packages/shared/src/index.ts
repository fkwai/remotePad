export type FsKind = 'file' | 'dir' | 'symlink';

export interface FsEntry {
  name: string;
  path: string;
  kind: FsKind;
  size?: number;
  mtimeMs?: number;
}

export interface FsListResponse {
  path: string;
  entries: FsEntry[];
}

export interface FsStatResponse {
  path: string;
  kind: FsKind;
  size: number;
  mtimeMs: number;
  image?: boolean;
}

export interface FsReadResponse {
  path: string;
  encoding: 'utf8' | 'base64';
  content: string;
  size: number;
  binary: boolean;
  mime?: string;
}

export interface FsWriteBody {
  path: string;
  content: string;
}

export interface FsPathBody {
  path: string;
}

export interface FsRenameBody {
  from: string;
  to: string;
}

export interface Favorite {
  path: string;
  name: string;
}

export interface FavoritesResponse {
  folders: Favorite[];
}

export interface RepoCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface Repo {
  path: string;
  name: string;
  startup?: string[];
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  lastCommit: RepoCommit | null;
}

export interface ReposResponse {
  repos: Repo[];
  controlPath: string;
}

export interface SessionTab {
  path: string;
  viewMode: 'rendered' | 'source' | 'icons' | 'details';
  folder?: boolean;
}

export interface SessionState {
  repoPath: string | null;
  treeRoot: string;
  selected: string | null;
  expanded: string[];
  tabs: SessionTab[];
  activePath: string | null;
  sideTab: 'favorites' | 'repos';
  termOpen: boolean;
  rightTab: 'agent' | 'machine';
}

export interface SearchHit {
  path: string;
  name: string;
  kind: FsKind;
}

export interface SearchResponse {
  query: string;
  path: string;
  hits: SearchHit[];
  truncated: boolean;
}

export interface MachineInfo {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  homedir: string;
  cwd: string;
  user: string;
  roots: string[];
}

export interface TermSessionInfo {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  cols: number;
  rows: number;
  alive: boolean;
}

export type TermClientMessage =
  | { type: 'create'; cwd?: string; name?: string; cols?: number; rows?: number }
  | { type: 'attach'; id: string; cols?: number; rows?: number }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'list' }
  | { type: 'rename'; id: string; name: string }
  | { type: 'close'; id: string };

export type TermServerMessage =
  | { type: 'created'; session: TermSessionInfo }
  | { type: 'attached'; session: TermSessionInfo; replay: string }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number | null }
  | { type: 'list'; sessions: TermSessionInfo[] }
  | { type: 'renamed'; session: TermSessionInfo }
  | { type: 'closed'; id: string }
  | { type: 'error'; message: string };

export type WatchClientMessage =
  | { type: 'watch'; path: string }
  | { type: 'unwatch'; path: string };

export type WatchServerMessage =
  | { type: 'change'; path: string; event: string }
  | { type: 'open'; path: string; termId?: string; title?: string }
  | { type: 'error'; message: string };

export interface UiOpenBody {
  path: string;
  termId?: string;
  title?: string;
}

export interface UiOpenResponse {
  ok: true;
  path: string;
  termId?: string;
  title?: string;
}

export interface TermPlotInfo {
  path: string;
  title: string;
  termId: string;
  at: number;
}

export interface GitFileStatus {
  path: string;
  index: string;
  working: string;
}

export interface GitStatusResponse {
  repoRoot: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitDiffResponse {
  repoRoot: string;
  path: string;
  diff: string;
}

export type AgentChangeKind = 'create' | 'modify' | 'delete';

export interface AgentChange {
  path: string;
  kind: AgentChangeKind;
  diff: string;
  binary?: boolean;
  /** Full text before the edit (text files only); for line-level keep/undo. */
  before?: string;
  /** Full text after the edit (text files only). */
  after?: string;
}

export type AgentStatus = 'idle' | 'running' | 'error';

/** Local XiaoBa embed vs CatsCo cloud employee (via Dashboard connector). */
export type AgentBackend = 'local' | 'catsco';

export interface AgentHistoryItem {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  name?: string;
}

export interface AgentSessionInfo {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  pinned?: boolean;
  /** Absolute path to this session's JSONL history file. */
  historyPath?: string;
}

/** CatsCo cloud account data for the Agent panel's left list. */
export interface AgentCatsCoBot {
  uid: string;
  name: string;
  isCurrent: boolean;
}

export interface AgentCatsCoProject {
  id: number;
  name: string;
}

export interface AgentCatsCoConversation {
  /** CatsCo topic id — `p2p_<user>_<bot>` or `grp_<id>`. */
  id: string;
  title: string;
  preview: string;
  projectId?: number;
  projectName?: string;
  isGroup: boolean;
  isTask?: boolean;
  updatedAt?: number;
  /** Cloud task state: the agent is still working on this conversation. */
  working?: boolean;
  /** Cloud-provided progress text, e.g. "正在处理请求". */
  statusText?: string;
}

export interface AgentCatsCoList {
  bots: AgentCatsCoBot[];
  projects: AgentCatsCoProject[];
  conversations: AgentCatsCoConversation[];
  topicId?: string;
  userUid?: string;
  ready?: boolean;
  error?: string;
}

/** Legacy Helper session id. New Helpers are `helper-*`. */
export const HELPER_SESSION_ID = 'helper';

export function isHelperSessionId(id: string | undefined): boolean {
  if (!id) return false;
  return id === HELPER_SESSION_ID || /^helper-[a-z0-9]+$/i.test(id);
}

export type AgentClientMessage =
  | { type: 'hello'; cwd: string; includeHistory?: boolean }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'clear' }
  | { type: 'new'; helper?: boolean }
  | { type: 'open'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'delete'; id: string }
  | { type: 'accept'; path: string }
  | { type: 'undo'; path: string }
  | { type: 'accept_all' }
  | { type: 'undo_all' }
  /** Write a line-edited body back for one tracked file (per-line keep/undo). */
  | { type: 'apply'; path: string; content: string }
  /** Switch Agent dock between local XiaoBa and CatsCo cloud. */
  | { type: 'set_backend'; backend: AgentBackend }
  /** CatsCo only: pick another conversation (topic) from the left list. */
  | { type: 'catsco_select'; topicId: string }
  /** CatsCo only: reload bots / projects / conversations. */
  | { type: 'catsco_refresh' }
  /** CatsCo only: create a project. */
  | { type: 'catsco_project_create'; name: string }
  /** CatsCo only: create an agent-task session, optionally inside a project. */
  | { type: 'catsco_task_create'; name: string; projectId?: number }
  /** CatsCo only: switch the bound cloud employee. */
  | { type: 'catsco_bot_switch'; botUid: string }
  /** Helper only: commit worktree + push helper/* branch to origin. */
  | { type: 'publish' }
  /** Helper only: start/refresh the worktree preview instance (port 2027). */
  | { type: 'preview' }
  /** Helper only: merge helper/* into main, delete the worktree, stop the preview. */
  | { type: 'merge' };

export type AgentServerMessage =
  | {
    type: 'ready';
    cwd: string;
    model?: string;
    error?: string;
    sessionId?: string;
    history?: AgentHistoryItem[];
    sessions?: AgentSessionInfo[];
    changes: AgentChange[];
    backend?: AgentBackend;
  }
  | { type: 'backend'; backend: AgentBackend; model?: string; error?: string }
  | { type: 'sessions'; sessions: AgentSessionInfo[] }
  /** CatsCo left list: bots, projects and every conversation the account can see. */
  | ({ type: 'catsco_list' } & AgentCatsCoList)
  | { type: 'user'; text: string; sessionId?: string }
  | { type: 'text'; text: string; sessionId?: string }
  | { type: 'tool_start'; name: string; id?: string; input?: unknown; sessionId?: string }
  | { type: 'tool_end'; name: string; id?: string; ok?: boolean; result?: string; sessionId?: string }
  | { type: 'status'; state: AgentStatus; message?: string; sessionId?: string }
  /** Only ever for one session: the panel must not show another chat's edits. */
  | { type: 'changes'; files: AgentChange[]; touched?: string[]; sessionId?: string }
  | { type: 'error'; message: string; sessionId?: string };

export const TEXT_SIZE_LIMIT = 8 * 1024 * 1024;

export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_UI_PORT,
  readSettingsFile,
  resolveRuntimeSettings,
  type RemotePadSettings,
} from './settings.ts';

export {
  VIEWER_MODULE_IDS,
  VIEWER_MODULES,
  defaultViewerEnabled,
  isViewerModuleId,
  resolveViewerEnabled,
  type ModulesResponse,
  type ModulesToggleBody,
  type ViewerEnabledMap,
  type ViewerModuleId,
  type ViewerModuleInfo,
} from './modules.ts';

export {
  LLM_DEFAULT_BASE,
  LLM_DEFAULT_MAX_TOKENS,
  LLM_DEFAULT_MODEL,
  LLM_MODELS,
  type LlmSettingsPut,
  type LlmSettingsView,
} from './llm.ts';

export {
  type CatsCoLinkState,
  type CatsCoStatusView,
} from './catsco.ts';

export { type UpdateStatus, type UpdateResult } from './update.ts';
