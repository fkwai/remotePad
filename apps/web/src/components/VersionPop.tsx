import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '@remotepad/shared';
import { api } from '../api';

/**
 * Build / version panel behind the RemotePad wordmark.
 *
 * Shows what this install is running (release version, branch, commit), where it
 * lives, and whether origin has commits it does not. Updating stays on the
 * Update N button in the top bar; this panel can re-check without reloading.
 */
export function VersionPop({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await api<UpdateStatus>('/api/update'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const short = status?.head ? status.head.slice(0, 7) : '—';

  return (
    <div className="float-pop version-pop">
      <div className="float-pop-head">
        <span>RemotePad</span>
        <button className="ghost" onClick={onClose}>×</button>
      </div>
      <div className="version-body">
        <div className="version-title">
          v{status?.version ?? '—'}
          {status?.branch && <span className="version-branch">{status.branch}@{short}</span>}
        </div>

        {error && <p className="version-error">{error}</p>}

        {status && (
          <dl className="version-rows">
            <dt>Repo</dt>
            <dd title={status.repo}>{status.repo}</dd>
            <dt>Commit</dt>
            <dd title={status.head ?? ''}>{status.head ?? '—'}</dd>
            <dt>Tree</dt>
            <dd>{status.dirty ? 'local changes' : 'clean'}</dd>
            <dt>Origin</dt>
            <dd>
              {status.behind === 0 && status.ahead === 0
                ? 'up to date'
                : [
                  status.behind > 0 ? `${status.behind} to pull` : '',
                  status.ahead > 0 ? `${status.ahead} unpushed` : '',
                ].filter(Boolean).join(' · ')}
            </dd>
          </dl>
        )}

        {status?.warning && <p className="version-warn">{status.warning}</p>}

        <div className="version-actions">
          <button className="ghost" onClick={() => void load()} disabled={busy}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  );
}
