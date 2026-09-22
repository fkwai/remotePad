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
}

export type AgentStatus = 'idle' | 'running' | 'error';

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

/** Always-on Agent session that edits the RemotePad repo itself. */
export const HELPER_SESSION_ID = 'helper';

export type AgentClientMessage =
  | { type: 'hello'; cwd: string }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'clear' }
  | { type: 'new' }
  | { type: 'open'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'delete'; id: string }
  | { type: 'accept'; path: string }
  | { type: 'undo'; path: string }
  | { type: 'accept_all' }
  | { type: 'undo_all' };

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
  }
  | { type: 'sessions'; sessions: AgentSessionInfo[] }
  | { type: 'user'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; input?: unknown }
  | { type: 'tool_end'; name: string; ok?: boolean }
  | { type: 'status'; state: AgentStatus; message?: string }
  | { type: 'changes'; files: AgentChange[]; touched?: string[] }
  | { type: 'error'; message: string };

export const TEXT_SIZE_LIMIT = 8 * 1024 * 1024;

export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_UI_PORT,
  readSettingsFile,
  resolveRuntimeSettings,
  type RemotePadSettings,
} from './settings.ts';
