/** Git update state for the running install (GET /api/update). */
export interface UpdateStatus {
  repo: string;
  /** Release version from the checkout's package.json (e.g. `0.0.1`). */
  version?: string;
  branch: string | null;
  /** The lane this branch belongs to: stable (main), dev, nightly, or a preview. */
  channel?: 'stable' | 'dev' | 'nightly' | 'preview' | 'detached';
  /** The ref this branch tracks, e.g. `origin/nightly` (null when untracked). */
  upstream?: string | null;
  head: string | null;
  remoteHead: string | null;
  /** Commits on origin/<branch> this checkout does not have. */
  behind: number;
  /** Local commits not yet on the remote. */
  ahead: number;
  dirty: boolean;
  /** behind > 0, nothing local to lose, clean tree. */
  canUpdate: boolean;
  warning?: string;
  checkedAt: string;
}

/** Result of POST /api/update. */
export interface UpdateResult {
  ok: boolean;
  updated: boolean;
  head?: string | null;
  /** package.json / lockfile changed — dependencies must be installed. */
  needsInstall?: boolean;
  /** Web sources changed; the dist was rebuilt (or failed to). */
  needsBuild?: boolean;
  /** Server sources changed — the process must restart. */
  needsRestart?: boolean;
  /** Whether the automatic rebuild succeeded. */
  built?: boolean;
  buildError?: string;
  message: string;
  status?: UpdateStatus;
}

/** A preview instance started by `scripts/preview.sh` (GET /api/previews). */
export interface PreviewInfo {
  /** Feature name, i.e. the worktree branch suffix. */
  name: string;
  uiPort: number;
  apiPort?: number;
  /** The UI port answered a TCP connect just now. */
  alive: boolean;
}

/** One lane a runtime can follow (GET /api/channels). */
export interface ChannelStatus {
  name: 'stable' | 'dev' | 'nightly';
  /** Branch behind the channel name. */
  branch: string;
  /** Current head of origin/<branch>, null when the remote branch is missing. */
  head: string | null;
  /** Commits on the channel this checkout does not have. */
  behind: number;
  /** Commits here that the channel does not have. */
  ahead: number;
  /** This checkout is on that branch. */
  current: boolean;
}

/** Result of POST /api/channels (switching lane). */
export interface ChannelResult {
  ok: boolean;
  switched: boolean;
  channel?: string;
  head?: string;
  needsInstall?: boolean;
  needsBuild?: boolean;
  needsRestart?: boolean;
  built?: boolean;
  buildError?: string;
  message: string;
  status?: UpdateStatus;
}
