import { useCallback, useEffect, useState } from 'react';
import type { ChannelResult, ChannelStatus, PreviewInfo, UpdateStatus } from '@remotepad/shared';
import { api } from '../api';

/**
 * Build / version panel behind the RemotePad wordmark.
 *
 * Shows what this install is running (version, lane, commit), where it lives,
 * whether the lane is ahead, and which other lanes exist — with a switch button,
 * so moving between stable, dev and nightly never needs a git command.
 */
export function VersionPop({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [previews, setPreviews] = useState<PreviewInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [next, list, previewList] = await Promise.all([
        api<UpdateStatus>('/api/update'),
        api<{ channels: ChannelStatus[] }>('/api/channels').catch(() => ({ channels: [] })),
        api<{ previews: PreviewInfo[] }>('/api/previews').catch(() => ({ previews: [] })),
      ]);
      setStatus(next);
      setChannels(list.channels);
      setPreviews(previewList.previews);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const short = status?.head ? status.head.slice(0, 7) : '—';
  // `channel` arrives with newer servers; fall back to the branch name so an
  // older runtime still shows something meaningful.
  const lane = status?.channel ?? status?.branch ?? 'detached';

  const switchTo = async (channel: string) => {
    setSwitching(channel);
    setNote(null);
    try {
      const result = await api<ChannelResult>('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ channel }),
      });
      setNote(result.message);
      if (result.ok && result.switched) {
        // Server code does not hot-swap: reload only when nothing needs a restart.
        if (!result.needsRestart && !result.needsInstall) {
          window.setTimeout(() => window.location.reload(), 600);
          return;
        }
        await load();
        return;
      }
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="float-pop version-pop">
      <div className="float-pop-head">
        <span>RemotePad</span>
        <button className="ghost" onClick={onClose}>×</button>
      </div>
      <div className="version-body">
        <div className="version-title">
          v{status?.version ?? '—'}
          <span className="version-branch">{lane}@{short}</span>
        </div>

        {error && <p className="version-error">{error}</p>}

        {status && (
          <dl className="version-rows">
            <dt>Repo</dt>
            <dd title={status.repo}>{status.repo}</dd>
            <dt>Branch</dt>
            <dd title={status.upstream ? `tracks ${status.upstream}` : 'no upstream'}>
              {status.branch ?? '—'}
              {status.upstream ? ` → ${status.upstream}` : ''}
            </dd>
            <dt>Commit</dt>
            <dd title={status.head ?? ''}>{status.head ?? '—'}</dd>
            <dt>Tree</dt>
            <dd>{status.dirty ? 'local changes' : 'clean'}</dd>
            <dt>Lane</dt>
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

        {channels.length > 0 && (
          <div className="version-channels">
            <div className="version-previews-head"><span>Channels</span></div>
            {channels.map((channel) => (
              <div
                className={`version-channel ${channel.current ? 'current' : ''}`}
                key={channel.name}
              >
                <span className="version-channel-name">{channel.name}</span>
                <span className="version-channel-meta">
                  {channel.head ? channel.head.slice(0, 7) : 'missing'}
                  {channel.current
                    ? ' · here'
                    : channel.behind > 0 ? ` · ${channel.behind} behind` : ' · same'}
                </span>
                {!channel.current && channel.head && (
                  <button
                    type="button"
                    className="ghost version-channel-go"
                    disabled={Boolean(switching) || Boolean(status?.dirty)}
                    title={status?.dirty ? 'Commit or discard local changes first' : `Switch to ${channel.name}`}
                    onClick={() => void switchTo(channel.name)}
                  >
                    {switching === channel.name ? '…' : 'Switch'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {note && <p className="version-note">{note}</p>}

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
