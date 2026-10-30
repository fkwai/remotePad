import os from 'node:os';
import path from 'node:path';

/**
 * Where the user's own settings live.
 *
 * The account's home, deliberately not `$HOME`: a preview lane overrides `$HOME`
 * to keep its *runtime* state (sessions, accepted edits, caches) separate, but
 * the favourite folders and the repo list belong to the user, not to one
 * instance. Copying them into each lane meant a lane could silently show a stale
 * list, and edits made in a lane never reached the real profile.
 *
 * `REMOTEPAD_SHARED_STATE` pins the location; the test suite points it at a temp
 * directory to exercise a fresh profile.
 */
export function sharedStateDir(): string {
  const pinned = process.env.REMOTEPAD_SHARED_STATE;
  if (pinned) return path.resolve(pinned);
  try {
    const home = os.userInfo().homedir;
    if (home) return path.join(home, '.remotepad');
  } catch {
    // No passwd entry (containers, odd platforms): fall back to $HOME.
  }
  return path.join(os.homedir(), '.remotepad');
}

export function sharedStateFile(name: string): string {
  return path.join(sharedStateDir(), name);
}
