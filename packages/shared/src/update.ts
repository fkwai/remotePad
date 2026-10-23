/** Git update state for the running install (GET /api/update). */
export interface UpdateStatus {
  repo: string;
  branch: string | null;
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
  message: string;
  status?: UpdateStatus;
}
