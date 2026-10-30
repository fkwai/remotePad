import { useCallback, useEffect, useState } from 'react';
import type { ChannelStatus, LaneInfo, PreviewInfo, UpdateStatus, WindowInfo } from '@remotepad/shared';
import { api } from '../api';
import { newWindowId, windowUrl } from '../window';

/** Lanes that are channels in their own right, not one-off previews. */
const CHANNEL_NAMES = new Set(['stable', 'dev', 'nightly']);

/**
 * Brand panel: what this install runs, the lanes beside it, and the windows
 * saved on this machine.
 *
 * Loading happens in two passes. Everything except the remote comparison comes
 * from local files and local git, so the panel draws immediately; the fetch to
 * origin — the only slow part — fills in behind/ahead afterwards. Waiting for it
 * before showing anything made a 4-second panel out of a 5-millisecond one.
 */
export function VersionPop({ onClose, currentWindow }: { onClose: () => void; currentWindow: string }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  /** Set once the remote comparison has arrived; null while still measuring. */
  const [remote, setRemote] = useState<UpdateStatus | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [lanes, setLanes] = useState<LaneInfo[]>([]);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [previews, setPreviews] = useState<PreviewInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Lane names asked to start that have not answered yet. */
  const [starting, setStarting] = useState<string[]>([]);

  /** Fast pass: local git only, plus every list that lives on disk. */
  const loadLocal = useCallback(async () => {
    try {
      const [next, channelList, laneList, windowList, previewList] = await Promise.all([
        api<UpdateStatus>('/api/update?remote=0'),
        api<{ channels: ChannelStatus[] }>('/api/channels').catch(() => ({ channels: [] })),
        api<{ lanes: LaneInfo[] }>('/api/lanes').catch(() => ({ lanes: [] })),
        api<{ windows: WindowInfo[] }>('/api/windows').catch(() => ({ windows: [] })),
        api<{ previews: PreviewInfo[] }>('/api/previews').catch(() => ({ previews: [] })),
      ]);
      setStatus(next);
      setChannels(channelList.channels);
      setLanes(laneList.lanes);
      setWindows(windowList.windows);
      setPreviews(previewList.previews);
      setError(null);
      setStarting((prev) => prev.filter((name) => !laneList.lanes.find((lane) => lane.name === name)?.alive));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Slow pass: the fetch to origin, which is what "behind" needs. */
  const loadRemote = useCallback(async () => {
    try {
      setRemote(await api<UpdateStatus>('/api/update'));
    } catch {
      // Offline or no remote: the local view stays, the counts stay blank.
      setRemote(null);
    }
  }, []);

  useEffect(() => {
    void loadLocal();
    void loadRemote();
  }, [loadLocal, loadRemote]);

  // Keep polling while a lane is coming up: building a worktree takes a while
  // and the port is the only honest signal that it is ready.
  useEffect(() => {
    if (!starting.length) return undefined;
    const timer = window.setInterval(() => { void loadLocal(); }, 2500);
    return () => window.clearInterval(timer);
  }, [starting.length, loadLocal]);

  const short = status?.head ? status.head.slice(0, 7) : '—';
  const laneName = status?.channel ?? status?.branch ?? 'detached';
  const drift = remote
    ? (remote.behind === 0 && remote.ahead === 0
      ? 'up to date'
      : [remote.behind > 0 ? `${remote.behind} to pull` : '', remote.ahead > 0 ? `${remote.ahead} unpushed` : '']
        .filter(Boolean).join(' · '))
    : null;

  const openPort = (port: number) => {
    const url = `http://${location.hostname}:${port}/`;
    window.open(url, '_blank', 'noopener');
    setNote(`Opened ${url}`);
  };

  const runLane = async (name: string) => {
    setNote(`Starting ${name}…`);
    setStarting((prev) => (prev.includes(name) ? prev : [...prev, name]));
    try {
      await api(`/api/lanes/${name}/start`, { method: 'POST' });
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
      setStarting((prev) => prev.filter((item) => item !== name));
    }
  };

  const openWindow = (id: string) => {
    window.open(windowUrl(id), '_blank', 'noopener');
  };

  const deleteWindow = async (id: string) => {
    try {
      await api(`/api/windows/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setWindows((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };

  // Channels own dev and nightly now, so they must not appear twice.
  const featurePreviews = previews.filter((item) => !CHANNEL_NAMES.has(item.name));

  return (
    <div className="float-pop version-pop">
      <div className="float-pop-head">
        <span>RemotePad</span>
        <button className="ghost" onClick={onClose}>×</button>
      </div>
      <div className="version-body">
        <div className="version-title">
          v{status?.version ?? '—'}
          <span className="version-branch">{laneName}@{short}</span>
          {status?.dirty ? <span className="version-dirty">local changes</span> : null}
          {drift && <span className="version-drift">{drift}</span>}
        </div>

        {error && <p className="version-error">{error}</p>}

        <div className="version-windows">
          <div className="version-previews-head">
            <span>Windows</span>
            <button
              type="button"
              className="ghost version-window-new"
              onClick={() => window.open(windowUrl(newWindowId()), '_blank', 'noopener')}
            >+ New</button>
          </div>
          {windows.length === 0 && <p className="version-empty">No saved windows yet.</p>}
          {windows.map((item) => (
            <div className={`version-window ${item.id === currentWindow ? 'current' : ''}`} key={item.id}>
              <button
                type="button"
                className="version-window-open"
                title={`Open ${item.path || 'window'} in a new tab`}
                onClick={() => openWindow(item.id)}
              >
                <span className="version-window-label">{item.label}</span>
                <span className="version-window-id">
                  {item.id}{item.id === currentWindow ? ' · here' : ''}
                </span>
              </button>
              {item.id !== 'default' && (
                <button
                  type="button"
                  className="ghost version-window-del"
                  title={`Delete the saved profile for ${item.id}`}
                  onClick={() => void deleteWindow(item.id)}
                >×</button>
              )}
            </div>
          ))}
        </div>

        {channels.length > 0 && (
          <div className="version-channels">
            <div className="version-previews-head"><span>Channels</span></div>
            {channels.map((channel) => {
              const lane = lanes.find((item) => item.name === channel.name);
              const live = Boolean(lane?.alive);
              const port = lane?.uiPort;
              const isStarting = starting.includes(channel.name);
              return (
                <div className={`version-channel ${channel.current ? 'current' : ''}`} key={channel.name}>
                  <span className="version-channel-name">{channel.name}</span>
                  <span className="version-channel-meta">
                    {channel.head ? channel.head.slice(0, 7) : 'missing'}
                    {channel.current
                      ? ' · here'
                      // stable is the install itself, not a lane that can be started
                      : channel.name === 'stable' && !live
                        ? ' · install'
                        : isStarting ? ' · starting…' : live ? ` · :${port}` : ' · stopped'}
                    {!channel.current && channel.behind > 0 ? ` · ${channel.behind} behind` : ''}
                  </span>
                  {lane && (
                    <button
                      type="button"
                      className="ghost version-channel-go"
                      title={live ? `Restart ${channel.name}` : `Run ${channel.name} (builds its worktree)`}
                      disabled={isStarting}
                      onClick={() => void runLane(channel.name)}
                    >
                      {isStarting ? '…' : 'Run'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost version-channel-go"
                    title={port ? `Open ${channel.name} on port ${port}` : 'Not running yet'}
                    disabled={!live || !port}
                    onClick={() => port && openPort(port)}
                  >Open</button>
                </div>
              );
            })}
          </div>
        )}

        {note && <p className="version-note">{note}</p>}

        <div className="version-previews">
          <div className="version-previews-head">
            <span>Previews</span>
            <button
              type="button"
              className="ghost version-refresh"
              title="Re-read windows, channels and previews"
              onClick={() => { void loadLocal(); void loadRemote(); }}
            >↻</button>
          </div>
          {featurePreviews.length === 0 && (
            <p className="version-empty">No feature previews running.</p>
          )}
          {featurePreviews.map((preview) => (
              <div className={`version-preview ${preview.alive ? 'live' : 'dead'}`} key={preview.name}>
                <span className="version-preview-name" title={preview.name}>{preview.name}</span>
                <span className="version-preview-port">:{preview.uiPort}</span>
                <button
                  type="button"
                  className="ghost version-preview-copy"
                  title={preview.alive ? `Open :${preview.uiPort}` : 'Not running'}
                  disabled={!preview.alive}
                  onClick={() => openPort(preview.uiPort)}
                >open</button>
              </div>
          ))}
        </div>
      </div>
    </div>
  );
}
