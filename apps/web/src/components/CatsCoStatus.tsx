import { useCallback, useEffect, useState } from 'react';
import type { CatsCoStatusView } from '@remotepad/shared';
import { api } from '../api';

export function CatsCoStatus() {
  const [view, setView] = useState<CatsCoStatusView | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setNote('');
    try {
      const next = await api<CatsCoStatusView>('/api/catsco');
      setView(next);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = view?.state || 'unknown';
  return (
    <div className="catsco-status">
      <div className="catsco-row">
        <span className={`catsco-dot ${state}`} title={state} />
        <span className="catsco-summary">{view?.summary || (busy ? 'Checking…' : '—')}</span>
      </div>
      {view?.user && (
        <div className="kv">
          Account <b>{view.user.displayName || view.user.username}</b>
          {view.user.username ? ` · @${view.user.username}` : ''}
        </div>
      )}
      {view?.device && (
        <div className="kv">
          Device <b>{view.device.name}</b>
          {view.device.deviceId && view.device.deviceId !== view.device.name
            ? ` · ${view.device.deviceId}`
            : ''}
        </div>
      )}
      {view?.botName && (
        <div className="kv">
          Cloud Agent <b>{view.botName}</b>
          {view.cloudChatReady ? ' · ready for Agent dock' : ''}
        </div>
      )}
      {view && !view.cloudChatReady && view.cloudChatReason && (
        <div className="kv warn">{view.cloudChatReason}</div>
      )}
      {view && (
        <div className="kv muted">
          {view.runtimeMode || '—'}
          {view.serviceRunning ? ' · connector process running' : ' · connector process stopped'}
          {typeof view.uptimeSec === 'number' ? ` · up ${fmtUptime(view.uptimeSec)}` : ''}
        </div>
      )}
      {view?.authError && <div className="kv warn">{view.authError}</div>}
      {note && <div className="kv warn">{note}</div>}
      <div className="catsco-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
          {busy ? '…' : 'Refresh'}
        </button>
        {view?.appUrl && (
          <a className="ghost linkish" href={view.appUrl} target="_blank" rel="noreferrer">
            Open CatsCo
          </a>
        )}
        {view?.dashboardUrl && (
          <a className="ghost linkish" href={view.dashboardUrl} target="_blank" rel="noreferrer">
            Dashboard
          </a>
        )}
      </div>
      <div className="kv muted">
        Status from the existing XiaoBa Dashboard — RemotePad does not start a second connector.
      </div>
    </div>
  );
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
