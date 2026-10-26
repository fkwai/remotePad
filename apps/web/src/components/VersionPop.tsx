import { useCallback, useEffect, useState } from 'react';
import type { PreviewInfo, UpdateStatus } from '@remotepad/shared';
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
  const [previews, setPreviews] = useState<PreviewInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [next, list] = await Promise.all([
        api<UpdateStatus>('/api/update'),
        api<{ previews: PreviewInfo[] }>('/api/previews').catch(() => ({ previews: [] })),
      ]);
      setStatus(next);
      setPreviews(list.previews);
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

        <div className="version-previews">
          <div className="version-previews-head">
            <span>Previews</span>
            {previews.length > 0 && <span className="version-previews-count">{previews.length}</span>}
          </div>
          {previews.length === 0 && (
            <p className="version-empty">
              None running. <code>scripts/preview.sh &lt;feature&gt;</code> starts one.
            </p>
          )}
          {previews.map((preview) => (
            <div className={`version-preview ${preview.alive ? 'live' : 'dead'}`} key={preview.name}>
              <span className="version-preview-name" title={preview.name}>{preview.name}</span>
              <span className="version-preview-port">:{preview.uiPort}</span>
              <button
                type="button"
                className="ghost version-preview-copy"
                title={`ssh -N -L ${preview.uiPort}:127.0.0.1:${preview.uiPort} <host-alias>`}
                onClick={() => {
                  const cmd = `ssh -N -L ${preview.uiPort}:127.0.0.1:${preview.uiPort} <host-alias>`;
                  navigator.clipboard?.writeText(cmd).catch(() => undefined);
                }}
              >
                tunnel
              </button>
            </div>
          ))}
        </div>

        <div className="version-actions">
          <button className="ghost" onClick={() => void load()} disabled={busy}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  );
}
