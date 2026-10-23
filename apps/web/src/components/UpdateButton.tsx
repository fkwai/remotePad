import { useCallback, useEffect, useState } from 'react';
import type { UpdateResult, UpdateStatus } from '@remotepad/shared';
import { api } from '../api';

/**
 * "Behind origin" indicator in the top bar.
 *
 * The runtime polls its own checkout (GET /api/update). When origin has commits
 * this install does not, one click fast-forwards it (POST /api/update) and
 * reloads; the server refuses when the tree is dirty or the branch has local
 * commits, so a button click can never discard work.
 */
export function UpdateButton({ onToast }: { onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      setStatus(await api<UpdateStatus>('/api/update'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    void check();
    const timer = window.setInterval(() => void check(), 120_000);
    return () => window.clearInterval(timer);
  }, [check]);

  if (!status) return null;

  // Always show which build is running: on a feature branch there is no
  // origin/<branch> to compare, and "nothing to update" still needs an answer.
  if (status.behind === 0) {
    if (!status.head) return null;
    const short = status.head.slice(0, 7);
    const name = status.branch ?? 'detached';
    const note = status.warning ? ` · ${status.warning}` : '';
    return (
      <button
        type="button"
        className="version-chip"
        title={`${status.repo} · ${name} @ ${status.head}${note} — click to copy the hash`}
        onClick={() => {
          const written = navigator.clipboard?.writeText(status.head as string);
          written?.catch(() => undefined);
          onToast(`Copied ${short}`);
        }}
      >
        {name}@{short}
      </button>
    );
  }

  const apply = async () => {
    setBusy(true);
    try {
      const result = await api<UpdateResult>('/api/update', { method: 'POST' });
      onToast(result.message);
      // Reload only when the new code is actually live: a dist-serving install
      // needs a rebuild (done server-side) and server changes need a restart.
      const mustRestart = Boolean(result.needsInstall || result.needsRestart);
      if (result.updated && !mustRestart) {
        window.location.reload();
        return;
      }
      await check();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commits = `${status.behind} commit${status.behind === 1 ? '' : 's'}`;
  const title = status.canUpdate
    ? `origin/${status.branch} is ${commits} ahead — click to update`
    : `origin/${status.branch} is ${commits} ahead, but this checkout has local changes or commits`;

  return (
    <button
      type="button"
      className={`update-btn ${status.canUpdate ? 'ready' : 'blocked'}`}
      onClick={() => void apply()}
      disabled={busy || !status.canUpdate}
      title={title}
    >
      {busy ? 'Updating…' : `Update ${status.behind}`}
    </button>
  );
}
