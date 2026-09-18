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

export interface Workspace {
  path: string;
  name: string;
  startup?: string[];
}

export interface WorkspacesResponse {
  folders: Workspace[];
  controlPath: string;
}

export interface SessionTab {
  path: string;
  viewMode: 'rendered' | 'source' | 'icons' | 'details';
  folder?: boolean;
}

export interface SessionState {
  workspacePath: string | null;
  treeRoot: string;
  selected: string | null;
  expanded: string[];
  tabs: SessionTab[];
  activePath: string | null;
  sideTab: 'favorites' | 'workspace';
  termOpen: boolean;
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
  | { type: 'error'; message: string };

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

export const TEXT_SIZE_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_PORT = 3847;
export const DEFAULT_HOST = '127.0.0.1';
