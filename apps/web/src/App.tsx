import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels';
import type { AgentBackend, AgentCatsCoList, AgentChange, AgentClientMessage, AgentServerMessage, AgentSessionInfo, AgentStatus, Favorite, FsEntry, FsListResponse, FsReadResponse, FsStatResponse, GitDiffResponse, GitStatusResponse, MachineInfo, ModulesResponse, Repo, ReposResponse, SessionState, TermClientMessage, TermServerMessage, TermSessionInfo, ViewerEnabledMap, ViewerModuleId, WatchServerMessage, SessionSizes } from '@remotepad/shared';
import { defaultViewerEnabled } from '@remotepad/shared';
import { api } from './api';
import { basename, dirname, hasRenderedView, viewerKind } from './files';
import { prepareRunText } from './runSelection';
import { browserPadUrl, hasEntryDrag, readEntryDrag } from './dnd';
import { LeftSidebar, type SideTab } from './components/LeftSidebar';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { TerminalPanel } from './components/TerminalPanel';
import { UpdateButton } from './components/UpdateButton';
import { windowIdFromUrl, windowQuery } from './window';
import { clearFileClipboard, fileClipboard, setFileClipboard } from './fileClipboard';
import { mayReload } from './editorSync';
import { RightDock } from './components/RightDock';
import { TextClipMenu } from './components/ContextMenu';
import { HostPop } from './components/Popovers';
import { VersionPop } from './components/VersionPop';
import type { AgentChatMessage } from './components/AgentPanel';

export function App() {
  const padPath = typeof location !== 'undefined'
    ? (new URLSearchParams(location.search).get('pad') || '').trim()
    : '';
  const padMode = Boolean(padPath);
  const [treeRoot, setTreeRoot] = useState('/');
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Record<string, FsEntry[]>>({});
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TermSessionInfo[]>([]);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatusResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(!padMode);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [controlPath, setControlPath] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('favorites');
  /** Second editor pane. Null = one editor, which is the default for everyone. */
  const [splitPath, setSplitPath] = useState<string | null>(null);
  /** Which pane a file click lands in. */
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  /** Left editor pane share of the split; dragged by the divider. */
  const [splitRatio, setSplitRatio] = useState(0.5);
  /** Panel-group layout in percent, kept in the window profile. */
  const [sizes, setSizes] = useState<SessionSizes>({});
  const [versionOpen, setVersionOpen] = useState(false);
  /** Version + channel, the only chrome the corner needs. */
  const [meta, setMeta] = useState<{ version?: string; channel?: string; head?: string }>({});
  /** This tab's window id (`?w=`); 'default' for an ordinary link. */
  const win = useRef(windowIdFromUrl()).current;
  const winQuery = windowQuery(win);

  useEffect(() => {
    let cancelled = false;
    // The corner label needs version, channel and commit — all local. Asking the
    // full endpoint here fired a git fetch to origin on every page load, for
    // numbers this label never shows.
    api<{ version?: string; channel?: string; head?: string }>('/api/update?remote=0')
      .then((next) => { if (!cancelled) setMeta(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  /** Refresh the profile list whenever the corner menu opens. */
  const [hostOpen, setHostOpen] = useState(false);
  const [moduleEnabled, setModuleEnabled] = useState<Record<ViewerModuleId, boolean>>(defaultViewerEnabled);
  const moduleEnabledRef = useRef(moduleEnabled);
  moduleEnabledRef.current = moduleEnabled;
  const [addressDraft, setAddressDraft] = useState('');
  const [addressFocus, setAddressFocus] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [agentChanges, setAgentChanges] = useState<AgentChange[]>([]);
  /** Repos the open conversation is declared to be about. */
  const [sessionRepos, setSessionRepos] = useState<string[]>([]);
  /** A write landed outside every attached repo; ask once. */
  const [repoSuggestion, setRepoSuggestion] = useState<{ path: string; repo: string } | null>(null);
  /** Which conversation the current changes list belongs to. */
  const agentSessionKeyRef = useRef('');
  const [agentState, setAgentState] = useState<AgentStatus>('idle');
  const [agentError, setAgentError] = useState<string | undefined>();
  const [agentSessionId, setAgentSessionId] = useState<string | undefined>();
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [agentWorkingCwd, setAgentWorkingCwd] = useState('');
  const [agentBackend, setAgentBackend] = useState<AgentBackend>('local');
  const [catscoList, setCatscoList] = useState<AgentCatsCoList | undefined>();
  /** True between asking for another session and its ready: block Send meanwhile. */
  const [agentSwitching, setAgentSwitching] = useState(false);
  // Never let a missed ready leave the composer locked forever.
  useEffect(() => {
    if (!agentSwitching) return undefined;
    const timer = setTimeout(() => setAgentSwitching(false), 6000);
    return () => clearTimeout(timer);
  }, [agentSwitching]);
  const [addressDropOver, setAddressDropOver] = useState(false);

  const termWs = useRef<WebSocket | null>(null);
  const watchWs = useRef<WebSocket | null>(null);
  const agentWs = useRef<WebSocket | null>(null);
  const handleAgentEventRef = useRef<(msg: AgentServerMessage) => void>(() => undefined);
  const termWrite = useRef<(id: string, data: string) => void>(() => undefined);
  const watched = useRef(new Set<string>());
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const activeTermRef = useRef(activeTerm);
  activeTermRef.current = activeTerm;
  const sessionsRef = useRef(sessions);
  const openFileRef = useRef<(entry: FsEntry, opts?: { temp?: boolean; reload?: boolean }) => Promise<void>>(async () => undefined);
  sessionsRef.current = sessions;
  const treeRootRef = useRef(treeRoot);
  treeRootRef.current = treeRoot;
  const pendingRun = useRef<{ setup: string; text: string } | null>(null);
  const pendingAfterStartup = useRef<{ id: string; text: string } | null>(null);
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const controlPathRef = useRef(controlPath);
  controlPathRef.current = controlPath;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const agentSessionIdRef = useRef(agentSessionId);
  agentSessionIdRef.current = agentSessionId;
  const agentBackendRef = useRef(agentBackend);
  agentBackendRef.current = agentBackend;
  const agentStateRef = useRef(agentState);
  agentStateRef.current = agentState;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const sideTabRef = useRef(sideTab);
  const splitPathRef = useRef(splitPath);
  splitPathRef.current = splitPath;
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const profileLoadedRef = useRef(false);
  // Imperative handles: a panel group cannot take its layout as a prop, so the
  // saved numbers are applied once the profile has loaded.
  const colsGroup = useRef<ImperativePanelGroupHandle>(null);
  const mainGroup = useRef<ImperativePanelGroupHandle>(null);
  /** Panel groups fire onLayout at mount; recording that would overwrite the
   *  saved layout with the defaults before it has been applied. */
  const sizesGate = useRef(false);
  /** True once the window profile has been read, so the panels can take its layout. */
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Panels register with their group only after mounting, so a saved layout has
  // to be pushed once the group is ready — and retried, because the first frame
  // after a mount is often too early for the library to accept it.
  useEffect(() => {
    if (!profileLoaded) return undefined;
    let tries = 0;
    let timer = 0;
    const push = () => {
      const apply = (group: typeof colsGroup, layout?: number[], expected?: number) => {
        if (!layout || !expected || layout.length !== expected) return true;
        try {
          const handle = group.current;
          if (!handle) return false;
          handle.setLayout(layout);
          return true;
        } catch {
          // Layout rejected (pane count changed, or a value outside min/max).
          return false;
        }
      };
      const okCols = apply(colsGroup, sizes.cols, padMode ? 2 : 3);
      const okMain = apply(mainGroup, sizes.main, termOpen ? 2 : 1);
      tries += 1;
      if ((okCols && okMain) || tries > 20) {
        sizesGate.current = true;
        return;
      }
      timer = window.setTimeout(push, 50);
    };
    push();
    return () => window.clearTimeout(timer);
  }, [profileLoaded, sizes, padMode, termOpen]);
  const focusedPaneRef = useRef(focusedPane);
  focusedPaneRef.current = focusedPane;

  /**
   * The file the reader is working in: the right pane when it has focus, else
   * the left one.
   *
   * Shortcuts used to read activePathRef directly, so Ctrl+S in the right pane
   * saved the left pane's file — or a folder, which silently did nothing.
   */
  const focusedPath = () =>
    splitPathRef.current && focusedPaneRef.current === 'right'
      ? splitPathRef.current
      : activePathRef.current;
  sideTabRef.current = sideTab;
  const termOpenRef = useRef(termOpen);
  termOpenRef.current = termOpen;
  const agentMsgId = useRef(1);
  /** Current round (one send → one answer); tool rows carry it so the step count
   *  restarts at 1 per round instead of climbing across rounds. */
  const agentRound = useRef(0);
  /** Files whose "user edited" note has already gone to the server this round. */
  const reviewEditedSent = useRef<Set<string>>(new Set());
  /** Status as of the last message, updated synchronously: two status messages in
   *  one frame must still count as two transitions (idle → running). */
  const agentStatusRef = useRef<string>('idle');
  const sessionReady = useRef(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const loadDir = useCallback(async (dir: string) => {
    const res = await api<FsListResponse>(`/api/fs/list?path=${encodeURIComponent(dir)}`);
    setListings((prev) => ({ ...prev, [res.path]: res.entries }));
    watchPath(dir);
  }, []);

  const restoreTabs = useCallback(async (items: SessionState['tabs'], active: string | null, enabled?: ViewerEnabledMap) => {
    const loaded: OpenTab[] = [];
    for (const item of items) {
      const tab = await readTab(item.path, item.viewMode, item.folder, enabled);
      if (tab) loaded.push(tab);
    }
    setTabs(loaded);
    const next = active && loaded.some((tab) => tab.path === active)
      ? active
      : loaded[loaded.length - 1]?.path || null;
    setActivePath(next);
  }, []);

  function watchPath(dir: string) {
    if (watched.current.has(dir)) return;
    watched.current.add(dir);
    watchWs.current?.send(JSON.stringify({ type: 'watch', path: dir }));
  }

  useEffect(() => {
    let cancelled = false;
    sessionReady.current = false;
    api<MachineInfo>('/api/machine').then(setMachine).catch(() => undefined);
    (async () => {
      try {
        const [favs, listed, session, modules] = await Promise.all([
          api<{ folders: Favorite[] }>('/api/favorites').catch(() => ({ folders: [] as Favorite[] })),
          api<ReposResponse>('/api/repos').catch(() => ({ repos: [] as Repo[], controlPath: '' })),
          api<SessionState>(`/api/session${winQuery}`).catch(() => null),
          api<ModulesResponse>('/api/modules').catch(() => null),
        ]);
        if (cancelled) return;
        if (modules?.enabled) setModuleEnabled(modules.enabled);
        setFavorites(favs.folders);
        setRepos(listed.repos);
        if (listed.controlPath) setControlPath(listed.controlPath);
        if (padPath) {
          setTermOpen(false);
          let kind: 'file' | 'dir' = 'file';
          try {
            const st = await api<FsStatResponse>(`/api/fs/stat?path=${encodeURIComponent(padPath)}`);
            kind = st.kind === 'dir' ? 'dir' : 'file';
          } catch { /* open as file */ }
          const dir = kind === 'dir' ? padPath : dirname(padPath);
          setTreeRoot(dir);
          setSelected(padPath);
          setExpanded(new Set([dir]));
          await loadDir(dir);
          const tab = await readTab(padPath, undefined, kind === 'dir', modules?.enabled);
          if (tab) {
            setTabs([tab]);
            setActivePath(tab.path);
          }
        } else {
          const tree = session?.treeRoot || '/';
          const activeRepo = session?.repoPath && listed.repos.some((item) => item.path === session.repoPath)
            ? session.repoPath
            : null;
          setRepoPath(activeRepo);
          setTreeRoot(tree);
          setSelected(session?.selected || tree);
          setSideTab(session?.sideTab === 'repos' ? 'repos' : 'favorites');
          setSplitPath(typeof session?.splitPath === 'string' ? session.splitPath : null);
          const saved = session?.sizes;
          setSizes(saved && typeof saved === 'object' ? saved : {});
          if (typeof saved?.splitRatio === 'number') setSplitRatio(saved.splitRatio);
          profileLoadedRef.current = true;
          setProfileLoaded(true);
          setFocusedPane('left');
          setTermOpen(session?.termOpen ?? true);
          const expandedDirs = session?.expanded?.length ? session.expanded : [tree];
          setExpanded(new Set(expandedDirs));
          await loadDir(tree);
          for (const dir of expandedDirs) await loadDir(dir);
          if (session?.tabs?.length) await restoreTabs(session.tabs, session.activePath, modules?.enabled);
        }
      } catch (err) {
        if (!cancelled) showToast(String(err instanceof Error ? err.message : err));
        setTreeRoot('/');
        setSelected('/');
        setExpanded(new Set(['/']));
        void loadDir('/');
      } finally {
        if (!cancelled) sessionReady.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [loadDir, restoreTabs]);

  const sessionSig = useMemo(() => JSON.stringify({
    repoPath,
    treeRoot,
    selected,
    expanded: [...expanded].sort(),
    tabs: tabs
      .filter((tab) => tab.kind !== 'diff' && !tab.agentPath && !tab.temp)
      .map((tab) => ({ path: tab.path, viewMode: tab.viewMode, folder: tab.kind === 'folder' })),
    activePath,
    sideTab,
    termOpen,
  }), [repoPath, treeRoot, selected, expanded, tabs, activePath, splitPath, sizes, sideTab, termOpen]);

  /**
   * A pane may only show a file that is actually open, or nothing at all.
   *
   * Every other path into a stale pane — an agent change that closes a review
   * tab, a tab closed from its own ×, a restored profile whose file is gone —
   * lands here instead of rendering an empty editor.
   */
  useEffect(() => {
    const open = new Set(tabs.map((tab) => tab.path));
    const leftOk = activePath === null || open.has(activePath);
    const rightOk = splitPath === null || open.has(splitPath);
    if (leftOk && rightOk) return;
    // Prefer a file the other pane is not already showing: two panes on one file
    // reads like a bug even when it is legal.
    const spare = (taken: string | null) => tabs.find((tab) => tab.path !== taken)?.path
      ?? tabs[tabs.length - 1]?.path
      ?? null;
    if (!leftOk) setActivePath(spare(splitPath));
    if (!rightOk) setSplitPath(splitPath === null ? null : spare(activePath));
  }, [tabs, activePath, splitPath]);

  const putSession = (keepalive = false) => {
    if (padMode) return;
    const body = JSON.stringify({
      repoPath: repoPathRef.current,
      treeRoot: treeRootRef.current,
      selected: selectedRef.current,
      expanded: [...expandedRef.current],
      tabs: tabsRef.current
        .filter((tab) => tab.kind !== 'diff' && !tab.agentPath && !tab.temp)
        .map((tab) => ({ path: tab.path, viewMode: tab.viewMode, folder: tab.kind === 'folder' })),
      activePath: activePathRef.current,
      splitPath: splitPathRef.current,
      // Absent until the profile has loaded: an early save would otherwise
      // overwrite the stored layout with defaults.
      ...(profileLoadedRef.current
        ? { sizes: { ...sizesRef.current, splitRatio: splitRatioRef.current } }
        : {}),
      sideTab: sideTabRef.current,
      termOpen: termOpenRef.current,
      rightTab: 'agent' as const,
    } satisfies SessionState);
    if (keepalive) {
      void fetch(`/api/session${winQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
      return;
    }
    void api(`/api/session${winQuery}`, { method: 'PUT', body }).catch(() => undefined);
  };

  useEffect(() => {
    if (!sessionReady.current) return;
    const handle = window.setTimeout(() => putSession(false), 0);
    return () => window.clearTimeout(handle);
  }, [sessionSig]);

  useEffect(() => {
    const flush = () => {
      if (!sessionReady.current) return;
      putSession(true);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`);
      watchWs.current = ws;
      ws.onopen = () => {
        for (const path of watched.current) {
          ws.send(JSON.stringify({ type: 'watch', path }));
        }
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as WatchServerMessage;
        if (msg.type === 'open') {
          void openFileRef.current({ name: basename(msg.path), path: msg.path, kind: 'file' }, { reload: true });
          return;
        }
        if (msg.type !== 'change') return;
        const current = listingsRef.current;
        const dir = dirname(msg.path);
        if (current[msg.path]) void loadDir(msg.path);
        else if (current[dir]) void loadDir(dir);
        const open = tabsRef.current.find((tab) => tab.path === msg.path);
        if (open && open.kind === 'html') {
          void openFileRef.current({ name: basename(msg.path), path: msg.path, kind: 'file' }, { reload: true });
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry = window.setTimeout(connect, 800);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      watchWs.current?.close();
    };
  }, [loadDir]);

  useEffect(() => {
    if (padMode) return;
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/term`);
      termWs.current = ws;
      ws.onopen = () => {
        sendTerm({ type: 'list' });
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as TermServerMessage;
        if (msg.type === 'list') {
          setSessions(msg.sessions);
          const ids = msg.sessions.map((item) => item.id);
          for (const id of ids) sendTerm({ type: 'attach', id });
          setActiveTerm((cur) => (cur && ids.includes(cur) ? cur : ids[0] || null));
        } else if (msg.type === 'created' || msg.type === 'renamed') {
          setSessions((prev) => upsertSession(prev, msg.session));
          if (msg.type === 'created') {
            setActiveTerm(msg.session.id);
            const pending = pendingRun.current;
            pendingRun.current = null;
            if (pending?.setup) {
              const id = msg.session.id;
              window.setTimeout(() => sendTerm({ type: 'input', id, data: pending.setup }), 200);
              if (pending.text) {
                pendingAfterStartup.current = { id, text: pending.text };
                // Wait for repo startup (e.g. activate + python REPL) before pasting.
                window.setTimeout(() => {
                  const wait = pendingAfterStartup.current;
                  if (wait && wait.id === id) {
                    pendingAfterStartup.current = null;
                    sendTerm({ type: 'input', id, data: wait.text });
                  }
                }, 4000);
              }
            } else if (pending?.text) {
              sendTerm({ type: 'input', id: msg.session.id, data: pending.text });
            }
          }
        } else if (msg.type === 'attached') {
          setSessions((prev) => upsertSession(prev, msg.session));
          if (msg.replay) termWrite.current(msg.session.id, msg.replay);
          setActiveTerm((cur) => cur || msg.session.id);
        } else if (msg.type === 'data') {
          termWrite.current(msg.id, msg.data);
          const wait = pendingAfterStartup.current;
          if (wait && wait.id === msg.id && msg.data.includes('>>>')) {
            pendingAfterStartup.current = null;
            sendTerm({ type: 'input', id: wait.id, data: wait.text });
          }
        } else if (msg.type === 'exit') {
          setSessions((prev) => prev.map((item) => item.id === msg.id ? { ...item, alive: false } : item));
        } else if (msg.type === 'closed') {
          setSessions((prev) => prev.filter((item) => item.id !== msg.id));
          setActiveTerm((cur) => (cur === msg.id ? null : cur));
          void api('/api/ui/plots/clear', { method: 'POST', body: JSON.stringify({ termId: msg.id }) }).catch(() => undefined);
        } else if (msg.type === 'error') {
          showToast(msg.message);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry = window.setTimeout(connect, 800);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      termWs.current?.close();
    };
  }, []);

  useEffect(() => {
    if (padMode) return;
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent${winQuery}`);
      agentWs.current = ws;
      ws.onopen = () => {
        const cwd = repoPathRef.current || treeRootRef.current;
        ws.send(JSON.stringify({
          type: 'hello',
          cwd,
          includeHistory: !agentSessionIdRef.current,
        } satisfies AgentClientMessage));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as AgentServerMessage;
        handleAgentEventRef.current(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        // Only a local turn dies with the server. A CatsCo turn runs in the
        // cloud, so claiming it was interrupted invited a duplicate send; the
        // reconnect resyncs and reports the real state instead.
        if (agentBackendRef.current === 'local' && agentStateRef.current === 'running') {
          setAgentState('idle');
          setAgentMessages((prev) => [...prev, {
            id: agentMsgId.current++,
            role: 'status',
            text: 'Agent connection dropped (server restart?). This turn was interrupted — send again if needed.',
          }]);
        }
        retry = window.setTimeout(connect, 800);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      agentWs.current?.close();
    };
  }, []);

  useEffect(() => {
    const cwd = repoPath || treeRoot;
    if (agentWs.current?.readyState === WebSocket.OPEN) {
      agentWs.current.send(JSON.stringify({
        type: 'hello',
        cwd,
        includeHistory: false,
      } satisfies AgentClientMessage));
    }
  }, [repoPath, treeRoot]);

  useEffect(() => {
    const path = selected;
    if (!path) return;
    const handle = window.setTimeout(() => {
      api<GitStatusResponse>(`/api/git/status?path=${encodeURIComponent(path)}`)
        .then(setGit)
        .catch(() => setGit(null));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [selected, agentChanges]);

  const toggleDir = async (dir: string) => {
    const next = new Set(expanded);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      if (!listings[dir]) await loadDir(dir);
    }
    setExpanded(next);
  };

  const revealDir = async (dir: string) => {
    setTreeRoot(dir);
    setSelected(dir);
    setExpanded(new Set([dir]));
    await loadDir(dir);
  };

  const goUp = async () => {
    const cur = treeRootRef.current;
    if (cur === '/') return;
    const parent = dirname(cur) || '/';
    setTreeRoot(parent);
    setSelected(parent);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(parent);
      next.add(cur);
      return next;
    });
    await loadDir(parent);
    if (!listingsRef.current[cur]) await loadDir(cur);
  };

  const clearRepo = async () => {
    setRepoPath(null);
    await revealDir('/');
  };

  const pinFolder = async (dir: string) => {
    try {
      const res = await api<{ folders: Favorite[] }>('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ path: dir }),
      });
      setFavorites(res.folders);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const unpinFolder = async (dir: string) => {
    try {
      const res = await api<{ folders: Favorite[] }>(`/api/favorites?path=${encodeURIComponent(dir)}`, {
        method: 'DELETE',
      });
      setFavorites(res.folders);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const addRepo = async (dir: string) => {
    try {
      const res = await api<ReposResponse>('/api/repos', {
        method: 'POST',
        body: JSON.stringify({ path: dir }),
      });
      setRepos(res.repos);
      setControlPath(res.controlPath);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const removeRepo = async (dir: string) => {
    try {
      const res = await api<ReposResponse>(`/api/repos?path=${encodeURIComponent(dir)}`, {
        method: 'DELETE',
      });
      setRepos(res.repos);
      setControlPath(res.controlPath);
      if (repoPathRef.current === dir) setRepoPath(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const reloadRepos = async () => {
    try {
      const res = await api<ReposResponse>('/api/repos');
      setRepos(res.repos);
      setControlPath(res.controlPath);
    } catch {
      // ignore
    }
  };

  const reorderFavorites = async (paths: string[]) => {
    try {
      const res = await api<{ folders: Favorite[] }>('/api/favorites/order', {
        method: 'PUT',
        body: JSON.stringify({ paths }),
      });
      setFavorites(res.folders);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const reorderRepos = async (paths: string[]) => {
    try {
      const res = await api<ReposResponse>('/api/repos/order', {
        method: 'PUT',
        body: JSON.stringify({ paths }),
      });
      setRepos(res.repos);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleModule = async (id: ViewerModuleId, on: boolean) => {
    try {
      const res = await api<ModulesResponse>('/api/modules', {
        method: 'PUT',
        body: JSON.stringify({ id, on }),
      });
      setModuleEnabled(res.enabled);
      setTabs((prev) => prev.map((tab) => {
        if (tab.kind === 'folder' || tab.kind === 'diff' || tab.agentPath) return tab;
        const kind = viewerKind(tab.path, res.enabled);
        if (kind === tab.kind) return tab;
        if (kind === 'image' || kind === 'html') {
          return { ...tab, kind, viewMode: 'rendered', binary: kind === 'image', mediaRev: Date.now() };
        }
        return {
          ...tab,
          kind,
          viewMode: 'source',
          binary: kind === 'code' ? tab.binary : false,
        };
      }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const openFile = async (entry: FsEntry, opts?: { temp?: boolean; reload?: boolean }) => {
    if (entry.kind === 'dir') {
      await toggleDir(entry.path);
      return;
    }
    // A click in the right pane is a deliberate placement, so it is never a
    // preview tab — previews get evicted by the next click, which is what made
    // the right pane jump to an unrelated old file.
    const intoSplit = Boolean(splitPathRef.current) && focusedPaneRef.current === 'right';
    const keep = !opts?.temp || intoSplit;
    // A click belongs to the pane the reader is in. Focus is only ever moved by
    // clicking inside a pane, so opening the split no longer steals the next
    // tree click to the right-hand side.
    const existing = tabsRef.current.find((tab) => tab.path === entry.path);
    if (existing && opts?.reload && !mayReload(existing)) {
      // A watcher event or a terminal "open" must not replace text the reader is
      // still editing; it would also drop the caret at the end of the file.
      if (intoSplit) setSplitPath(entry.path);
      else setActivePath(entry.path);
      showToast(`${entry.name} changed on disk — unsaved edits kept`);
      return;
    }
    if (existing && !opts?.reload) {
      if (keep && existing.temp) {
        setTabs((prev) => prev.map((tab) => tab.path === entry.path ? { ...tab, temp: false } : tab));
      }
      if (intoSplit) setSplitPath(entry.path);
      else setActivePath(entry.path);
      return;
    }
    const kind = viewerKind(entry.path, moduleEnabledRef.current);
    if (!existing) {
      const tab: OpenTab = {
        path: entry.path,
        name: entry.name,
        content: '',
        savedContent: '',
        binary: false,
        viewMode: hasRenderedView(kind) ? 'rendered' : 'source',
        dirty: false,
        loading: true,
        kind,
        temp: !keep,
      };
      setTabs((prev) => {
        if (!keep) {
          // A preview tab is replaced by the next preview. A file a pane is
          // showing is not a preview any more, whatever opened it.
          const pinned = new Set([activePathRef.current, splitPathRef.current]);
          const rest = prev.filter((item) => !item.temp || (item.path && pinned.has(item.path)));
          return [tab, ...rest];
        }
        return [tab, ...prev];
      });
    } else {
      setTabs((prev) => prev.map((tab) => tab.path === entry.path
        ? { ...tab, loading: true, error: undefined, temp: keep ? false : tab.temp }
        : tab));
    }
    if (intoSplit) setSplitPath(entry.path);
    else setActivePath(entry.path);
    try {
      if (kind === 'image' || kind === 'html') {
        setTabs((prev) => prev.map((item) => item.path === entry.path ? {
          ...item,
          loading: false,
          binary: kind === 'image',
          content: '',
          savedContent: '',
          mediaRev: Date.now(),
        } : item));
        return;
      }
      const file = await api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(entry.path)}`);
      setTabs((prev) => prev.map((item) => item.path === entry.path ? {
        ...item,
        loading: false,
        content: file.binary ? '' : file.content,
        savedContent: file.binary ? '' : file.content,
        binary: file.binary,
        dirty: false,
        error: undefined,
      } : item));
    } catch (err) {
      setTabs((prev) => prev.map((item) => item.path === entry.path ? {
        ...item,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      } : item));
    }
  };
  openFileRef.current = openFile;

  const openFolder = async (dir: string, opts?: { newTab?: boolean; from?: string; viewMode?: OpenTab['viewMode'] }) => {
    await loadDir(dir);
    const name = basename(dir) || '/';
    const current = tabsRef.current;
    // A folder belongs to the pane the reader is in, exactly like a file. Loading
    // it into the left pane while they were working on the right made the address
    // bar feel like it went to the wrong place.
    const intoSplit = Boolean(splitPathRef.current) && focusedPaneRef.current === 'right';
    const show = (path: string) => {
      if (intoSplit) setSplitPath(path);
      else setActivePath(path);
    };
    const same = current.find((tab) => tab.kind === 'folder' && tab.path === dir);
    if (same) {
      show(dir);
      return;
    }
    // Never repoint a folder tab the other pane is showing: that would drag the
    // left pane to the new directory. Reuse only when the tab is free.
    const inUse = new Set([activePathRef.current, splitPathRef.current]);
    const reuse = opts?.newTab
      ? undefined
      : (
        (opts?.from ? current.find((tab) => tab.kind === 'folder' && tab.path === opts.from) : undefined)
        || current.find((tab) => tab.kind === 'folder' && tab.path === activePathRef.current)
        || current.find((tab) => tab.kind === 'folder' && !(intoSplit && inUse.has(tab.path)))
        || (intoSplit ? undefined : current.find((tab) => tab.kind === 'folder'))
      );
    const mode = opts?.viewMode === 'details' || opts?.viewMode === 'icons'
      ? opts.viewMode
      : (reuse?.viewMode === 'details' ? 'details' : 'icons');
    if (reuse) {
      setTabs((prev) => prev.map((tab) => tab.kind === 'folder' && tab.path === reuse.path
        ? { ...tab, path: dir, name, viewMode: mode }
        : tab));
      show(dir);
      return;
    }
    setTabs((prev) => [{
      path: dir,
      name,
      content: '',
      savedContent: '',
      binary: false,
      viewMode: mode,
      dirty: false,
      loading: false,
      kind: 'folder',
    }, ...prev]);
    show(dir);
  };

  const navigateFolder = (from: string, to: string) => {
    void openFolder(to, { from });
  };

  /** Put files on the in-app clipboard (Copy / Cut). */
  const copyFiles = useCallback((paths: string[], mode: 'copy' | 'cut') => {
    setFileClipboard({ mode, paths });
    showToast(`${paths.length === 1 ? basename(paths[0]!) : `${paths.length} items`} ${mode === 'cut' ? 'cut' : 'copied'}`);
  }, []);

  /**
   * Paste into a folder. Copy keeps the original and names the copy
   * `x copy.ext`; cut moves. Both refresh the folders that changed.
   */
  const pasteFiles = useCallback(async (into: string) => {
    const clip = fileClipboard();
    if (!clip) return;
    const dir = into.replace(/\/+$/, '') || '/';
    const touched = new Set<string>([dir]);
    try {
      for (const from of clip.paths) {
        if (clip.mode === 'cut') {
          const to = `${dir === '/' ? '' : dir}/${basename(from)}`;
          if (to === from) continue;
          await api('/api/fs/rename', { method: 'POST', body: JSON.stringify({ from, to }) });
          touched.add(from.slice(0, from.lastIndexOf('/')) || '/');
        } else {
          await api('/api/fs/copy', { method: 'POST', body: JSON.stringify({ from, into: dir }) });
        }
      }
      if (clip.mode === 'cut') clearFileClipboard();
      showToast(clip.mode === 'cut' ? `Moved to ${basename(dir) || '/'}` : `Copied to ${basename(dir) || '/'}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
    for (const target of touched) void loadDir(target);
  }, [loadDir]);

  const save = async (path: string) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab || tab.binary || tab.kind === 'diff' || tab.kind === 'folder') return;
    await api('/api/fs/write', { method: 'PUT', body: JSON.stringify({ path, content: tab.content }) });
    setTabs((prev) => prev.map((item) => item.path === path ? { ...item, savedContent: item.content, dirty: false, temp: false } : item));
    if (controlPathRef.current && path === controlPathRef.current) void reloadRepos();
  };

  const applyViewMode = useCallback((path: string, mode: OpenTab['viewMode']) => {
    setTabs((prev) => prev.map((tab) => tab.path === path ? { ...tab, viewMode: mode } : tab));
    const tab = tabsRef.current.find((item) => item.path === path);
    if (mode === 'source' && tab?.kind === 'html' && !tab.content && !tab.loading) {
      void api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(path)}`)
        .then((file) => {
          setTabs((prev) => prev.map((item) => item.path === path ? {
            ...item,
            content: file.binary ? '' : file.content,
            savedContent: file.binary ? '' : file.content,
            binary: file.binary,
          } : item));
        })
        .catch((err) => {
          setTabs((prev) => prev.map((item) => item.path === path ? {
            ...item,
            error: err instanceof Error ? err.message : String(err),
          } : item));
        });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const path = focusedPath();
        if (path) void save(path);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        if (padMode) return;
        e.preventDefault();
        setTermOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        e.stopPropagation();
        const path = focusedPath();
        const tab = path ? tabsRef.current.find((item) => item.path === path) : undefined;
        if (!tab || !hasRenderedView(tab.kind)) return;
        applyViewMode(path!, tab.viewMode === 'source' ? 'rendered' : 'source');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyViewMode, padMode]);

  useEffect(() => {
    const own = '.tree-body, .side-list, .folder-view, .folder-table, .folder-icons, .menu, .xterm, .xterm-screen, .tabs';
    const onMenu = (e: MouseEvent) => {
      const node = e.target as HTMLElement | null;
      if (node?.closest(own)) {
        setClipMenu(null);
        return;
      }
      const text = window.getSelection()?.toString() ?? '';
      if (text) setClipMenu({ x: e.clientX, y: e.clientY, text });
      else setClipMenu(null);
    };
    document.addEventListener('contextmenu', onMenu, true);
    return () => document.removeEventListener('contextmenu', onMenu, true);
  }, []);

  const runInTerminal = (text: string) => {
    if (!text) return;
    const payload = prepareRunText(text, focusedPath());
    if (!payload) return;
    setTermOpen(true);
    const hint = focusedPath() || selectedRef.current || treeRootRef.current;
    const repo = matchRepo(hint, reposRef.current);
    const setup = startupText(repo);
    const id = activeTermRef.current;
    const session = id
      ? sessionsRef.current.find((item) => item.id === id && item.alive)
      : undefined;
    const sameRepo = Boolean(
      session && repo && (session.cwd === repo.path || session.cwd.startsWith(`${repo.path}/`)),
    );
    // Workspace startup (venv + python) only runs when creating a terminal.
    // If the live term isn't in this repo, open a fresh one with startup.
    if (setup && !sameRepo) {
      pendingRun.current = { setup, text: payload };
      sendTerm({ type: 'create', cwd: repo?.path || treeRootRef.current, name: repo?.name });
      return;
    }
    if (session) {
      sendTerm({ type: 'input', id: session.id, data: payload });
      return;
    }
    pendingRun.current = { setup, text: payload };
    sendTerm({ type: 'create', cwd: repo?.path || treeRootRef.current, name: repo?.name });
  };

  const runStartup = (repo: Repo) => {
    const text = startupText(repo);
    if (!text) {
      showToast('No startup commands in the control file');
      return;
    }
    setTermOpen(true);
    const id = activeTermRef.current;
    const alive = id && sessionsRef.current.some((item) => item.id === id && item.alive);
    if (id && alive) {
      sendTerm({ type: 'input', id, data: text });
      return;
    }
    pendingRun.current = { setup: text, text: '' };
    sendTerm({ type: 'create', cwd: repo.path, name: repo.name });
  };

  const revealInTree = async (filePath: string) => {
    if (!filePath || filePath.startsWith('diff:') || filePath.startsWith('agent:')) return;
    const folders = reposRef.current;
    const currentRoot = treeRootRef.current;
    const currentRepo = folders.find((item) => item.path === repoPathRef.current) || null;
    const containing = matchRepo(filePath, folders);
    const isFolder = tabsRef.current.some((tab) => tab.path === filePath && tab.kind === 'folder')
      || Boolean(listingsRef.current[filePath]);
    let root = currentRoot;
    if (filePath === currentRoot || filePath.startsWith(currentRoot + '/') || currentRoot === '/') {
      root = currentRoot;
    } else if (currentRepo && (filePath === currentRepo.path || filePath.startsWith(currentRepo.path + '/'))) {
      root = currentRepo.path;
    } else if (containing) {
      root = containing.path;
      setRepoPath(containing.path);
      setSideTab('repos');
    } else {
      root = isFolder ? filePath : (dirname(filePath) || '/');
    }
    if (root !== currentRoot) {
      setTreeRoot(root);
      await loadDir(root);
    }
    const dirs = dirsToExpand(filePath, root);
    if (isFolder && !dirs.includes(filePath)) dirs.push(filePath);
    for (const dir of dirs) await loadDir(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
    setSelected(filePath);
    setRevealTick((n) => n + 1);
  };

  const createNode = async (dir: string, kind: 'file' | 'dir', name: string) => {
    const path = `${dir.replace(/\/$/, '')}/${name}`;
    if (kind === 'dir') await api('/api/fs/mkdir', { method: 'POST', body: JSON.stringify({ path }) });
    else await api('/api/fs/create', { method: 'POST', body: JSON.stringify({ path }) });
    await loadDir(dir);
    setExpanded((prev) => new Set(prev).add(dir));
  };

  const renameNode = async (from: string, name: string) => {
    const to = `${dirname(from)}/${name}`;
    await api('/api/fs/rename', { method: 'POST', body: JSON.stringify({ from, to }) });
    await loadDir(dirname(from));
    setTabs((prev) => prev.map((tab) => tab.path === from ? { ...tab, path: to, name } : tab));
    if (activePath === from) setActivePath(to);
    if (selected === from) setSelected(to);
  };

  const deleteNode = async (entry: FsEntry) => {
    await api(`/api/fs/delete?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
    await loadDir(dirname(entry.path));
    setTabs((prev) => prev.filter((tab) => tab.path !== entry.path && !tab.path.startsWith(entry.path + '/')));
    if (activePath === entry.path) setActivePath(null);
  };

  const deleteMany = async (entries: FsEntry[]) => {
    const dirs = new Set<string>();
    for (const entry of entries) {
      await api(`/api/fs/delete?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      dirs.add(dirname(entry.path));
    }
    for (const dir of dirs) await loadDir(dir);
    const gone = new Set(entries.map((item) => item.path));
    setTabs((prev) => prev.filter((tab) => {
      if (gone.has(tab.path)) return false;
      for (const entry of entries) {
        if (entry.kind === 'dir' && tab.path.startsWith(entry.path + '/')) return false;
      }
      return true;
    }));
    if (activePath && gone.has(activePath)) setActivePath(null);
  };

  const revertFile = async (filePath: string) => {
    const tab = tabsRef.current.find((item) => item.path === filePath);
    if (!tab || tab.binary || tab.kind === 'diff' || tab.kind === 'folder') return;
    const gitDirty = Boolean(git?.files.some((item) => item.path === filePath));
    if (!tab.dirty && !gitDirty) return;
    if (!window.confirm(`Revert ${tab.name} to last saved / committed status?`)) return;
    try {
      await api('/api/git/restore', { method: 'POST', body: JSON.stringify({ path: filePath }) });
    } catch {
      // not a git repo / restore failed — still reload from disk
    }
    await openFile({ name: tab.name, path: filePath, kind: 'file' }, { reload: true });
    try {
      const status = await api<GitStatusResponse>(`/api/git/status?path=${encodeURIComponent(filePath)}`);
      setGit(status);
    } catch {
      // ignore
    }
    showToast(`Reverted ${tab.name}`);
  };

  function sendTerm(msg: TermClientMessage) {
    if (termWs.current?.readyState === WebSocket.OPEN) {
      termWs.current.send(JSON.stringify(msg));
    }
  }

  const openTerminalHere = (dir: string) => {
    setTermOpen(true);
    const repo = reposRef.current.find((item) => item.path === dir);
    sendTerm({ type: 'create', cwd: dir, name: repo?.name || basename(dir) });
  };

  const createDefaultTerminal = () => {
    openTerminalHere(repoPathRef.current || treeRootRef.current);
  };

  const openDiff = async (path: string) => {
    const res = await api<GitDiffResponse>(`/api/git/diff?path=${encodeURIComponent(path)}`);
    const id = `diff:${path}`;
    const tab: OpenTab = {
      path: id,
      name: `${basename(path)} (diff)`,
      content: res.diff,
      savedContent: res.diff,
      binary: false,
      viewMode: 'source',
      dirty: false,
      loading: false,
      kind: 'diff',
      diff: res.diff,
    };
    setTabs((prev) => [tab, ...prev.filter((item) => item.path !== id)]);
    setActivePath(id);
  };

  const agentCwd = repoPath || treeRoot;
  const pendingPaths = useMemo(() => new Set(agentChanges.map((item) => item.path)), [agentChanges]);

  const sendAgent = (msg: AgentClientMessage) => {
    if (agentWs.current?.readyState === WebSocket.OPEN) {
      agentWs.current.send(JSON.stringify(msg));
    }
  };

  const reloadTouched = async (paths: string[]) => {
    for (const filePath of paths) {
      const parent = dirname(filePath) || '/';
      void loadDir(parent);
      const tab = tabsRef.current.find((item) => item.path === filePath);
      if (!tab || tab.kind === 'folder' || tab.kind === 'diff') continue;
      if (tab.dirty) showToast(`${basename(filePath)} reloaded from disk`);
      try {
        const file = await api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
        setTabs((prev) => prev.map((item) => item.path === filePath ? {
          ...item,
          content: file.binary ? '' : file.content,
          savedContent: file.binary ? '' : file.content,
          binary: file.binary,
          dirty: false,
          loading: false,
          error: undefined,
        } : item));
      } catch {
        setTabs((prev) => prev.filter((item) => item.path !== filePath));
        if (activePathRef.current === filePath) setActivePath(null);
      }
    }
  };

  const openAgentDiff = (change: AgentChange) => {
    const filePath = change.path;
    const synth = `agent:${filePath}`;
    const kind = viewerKind(filePath, moduleEnabledRef.current);
    setTabs((prev) => {
      const rest = prev.filter((item) => item.path !== synth);
      const existing = rest.find((item) => item.path === filePath);
      if (existing) {
        return rest.map((item) => item.path === filePath
          ? {
            ...item,
            temp: false,
            viewMode: 'source' as const,
            diff: change.diff,
            before: change.before,
            after: change.after,
            agentPath: filePath,
            hunks: change.hunks,
            keptHunks: change.keptHunks,
            userEdited: change.userEdited,
          }
          : item);
      }
      const tab: OpenTab = {
        path: filePath,
        name: basename(filePath),
        content: change.after ?? '',
        savedContent: change.after ?? '',
        binary: false,
        viewMode: 'source',
        dirty: false,
        loading: false,
        kind,
        diff: change.diff,
        before: change.before,
        after: change.after,
        agentPath: filePath,
        hunks: change.hunks,
        keptHunks: change.keptHunks,
        userEdited: change.userEdited,
      };
      return [tab, ...rest];
    });
    setActivePath(filePath);
  };

  /** Keep already-open editors in step with what the agent just wrote.
   *
   * Without this an open tab kept the bytes it loaded earlier, so the agent's
   * edit only appeared after closing and reopening the file.
   */
  const syncOpenTabs = async (files: AgentChange[], touched?: string[]) => {
    const scope = touched && touched.length
      ? files.filter((item) => touched.includes(item.path))
      : files;
    if (!scope.length) return;
    const wanted = new Map(scope.map((item) => [item.path, item]));
    for (const tab of tabsRef.current) {
      const change = wanted.get(tab.path);
      if (!change || tab.kind === 'folder' || tab.kind === 'diff') continue;
      // Never overwrite edits the reader has not saved.
      let content = tab.content;
      let saved = tab.savedContent;
      if (!tab.dirty && !tab.binary) {
        try {
          const file = await api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(tab.path)}`);
          if (!file.binary) {
            content = file.content;
            saved = file.content;
          }
        } catch {
          // The file may have been deleted; the change list already says so.
        }
      }
      setTabs((prev) => prev.map((item) => {
        if (item.path !== tab.path) return item;
        return {
          ...item,
          content,
          savedContent: saved,
          loading: false,
          diff: change.diff,
          before: change.before,
          after: change.after,
          agentPath: tab.path,
          hunks: change.hunks,
          keptHunks: change.keptHunks,
          userEdited: change.userEdited,
        };
      }));
    }
  };

  const applyAgentChanges = (files: AgentChange[], touched?: string[]) => {
    setAgentChanges(files);
    void syncOpenTabs(files, touched);
    const pending = new Set(files.map((item) => item.path));
    setTabs((prev) => prev
      // Drop leftover synthetic agent: tabs from the old flow.
      .filter((tab) => !(tab.path.startsWith('agent:') && tab.agentPath && !pending.has(tab.agentPath)))
      .map((tab) => {
        if (!tab.agentPath) return tab;
        const change = files.find((item) => item.path === tab.agentPath);
        if (!change) {
          // Review done (Keep/Undo). The tab stays open as a normal file tab —
          // closing it emptied the editor under the reader. Content is re-read
          // from disk by reloadTouched() below, so Keep shows the accepted text
          // and Undo shows the restored text.
          return { ...tab, agentPath: undefined, before: undefined, after: undefined, diff: undefined };
        }
        return {
          ...tab,
          diff: change.diff,
          before: change.before,
          after: change.after,
          hunks: change.hunks,
          keptHunks: change.keptHunks,
          userEdited: change.userEdited,
        };
      })
      .filter((tab): tab is OpenTab => Boolean(tab)));
    if (touched?.length) void reloadTouched(touched);
  };

  handleAgentEventRef.current = (msg) => {
    if (msg.type === 'ready') {
      const sameSession = Boolean(msg.sessionId && msg.sessionId === agentSessionIdRef.current);
      const backendChanged = Boolean(msg.backend && msg.backend !== agentBackendRef.current);
      agentSessionIdRef.current = msg.sessionId;
      setAgentError(msg.error);
      setAgentSessionId(msg.sessionId);
      if (msg.cwd) setAgentWorkingCwd(msg.cwd);
      if (msg.sessions) setAgentSessions(msg.sessions);
      if (msg.backend) setAgentBackend(msg.backend);
      setAgentChanges(msg.changes);
      if (msg.sessionKey) {
        const switched = agentSessionKeyRef.current && agentSessionKeyRef.current !== msg.sessionKey;
        agentSessionKeyRef.current = msg.sessionKey;
        // A review tab belongs to the conversation that produced it. Leaving it
        // open after switching sessions showed another chat's diff in this one.
        if (switched) setTabs((prev) => prev.filter((tab) => !tab.agentPath));
      }
      setSessionRepos(msg.repos ?? []);
      setAgentSwitching(false);
      // Replace transcript on session switch, Local↔CatsCo switch, or CatsCo topic load.
      // Empty [] must clear the pane (do not keep the other backend's messages).
      if (Array.isArray(msg.history)) {
        const replace = !sameSession || backendChanged || msg.backend === 'catsco';
        const mapped = msg.history.map((item) => ({
          id: agentMsgId.current++,
          role: item.role,
          text: item.text,
          name: item.name,
        }));
        // An empty pane refills too: after a reload the session id is unchanged,
        // so the old guard left Local blank.
        setAgentMessages((prev) => (replace || prev.length === 0 ? mapped : prev));
      }
      agentStatusRef.current = msg.error ? 'error' : 'idle';
      setAgentState((prev) => {
        if (msg.error) return 'error';
        // Session / backend switches must leave Working; only keep running for same-tab hello.
        if (!sameSession || backendChanged || msg.backend === 'catsco') return 'idle';
        return prev === 'running' ? prev : 'idle';
      });
    } else if (msg.type === 'backend') {
      setAgentBackend(msg.backend);
      if (msg.error !== undefined) setAgentError(msg.error);
    } else if (msg.type === 'sessions') {
      setAgentSessions(msg.sessions);
    } else if (msg.type === 'catsco_list') {
      setCatscoList({
        bots: msg.bots,
        projects: msg.projects,
        conversations: msg.conversations,
        topicId: msg.topicId,
        userUid: msg.userUid,
        ready: msg.ready,
        error: msg.error,
      });
    } else if (msg.type === 'user') {
      setAgentMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'user' && last.text === msg.text) return prev;
        return [...prev, { id: agentMsgId.current++, role: 'user', text: msg.text }];
      });
    } else if (msg.type === 'text') {
      setAgentMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
        }
        return [...prev, { id: agentMsgId.current++, role: 'assistant', text: msg.text }];
      });
    } else if (msg.type === 'tool_start') {
      const round = agentRound.current;
      setAgentMessages((prev) => [...prev, {
        id: agentMsgId.current++,
        role: 'tool',
        name: msg.name,
        text: '',
        toolId: msg.id,
        input: msg.input ? compactInput(msg.input) : '',
        round,
      }]);
    } else if (msg.type === 'tool_end') {
      const print = msg.result || '';
      setAgentMessages((prev) => {
        const next = prev.slice();
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          const row = next[i];
          if (row.role !== 'tool') continue;
          if (msg.id && row.toolId === msg.id) { idx = i; break; }
        }
        if (idx < 0) {
          for (let i = next.length - 1; i >= 0; i--) {
            const row = next[i];
            if (row.role === 'tool' && row.name === msg.name && !row.text) { idx = i; break; }
          }
        }
        if (idx >= 0) {
          next[idx] = { ...next[idx], text: print };
          return next;
        }
        return [...next, { id: agentMsgId.current++, role: 'tool', name: msg.name, text: print, toolId: msg.id }];
      });
    } else if (msg.type === 'status') {
      // A round begins when the server goes running. Counting on that transition
      // (not on every tool row) is what makes "step 1" mean the first step of
      // this round, even when the previous round ended on a step.
      if (msg.state === 'running' && agentStatusRef.current !== 'running') {
        agentRound.current += 1;
      }
      agentStatusRef.current = msg.state;
      setAgentState(msg.state);
      if (msg.message === 'cleared' || msg.message === 'new') {
        agentRound.current = 0;
        setAgentMessages([]);
      }
    } else if (msg.type === 'changes') {
      // Another conversation's edits must not paint this tree: the socket is
      // shared, so the key decides.
      // Fail open: only a known, different conversation is ignored. A stale or
      // empty key used to hide every change, which read as "the diff is gone".
      if (!agentSessionKeyRef.current && msg.sessionKey) agentSessionKeyRef.current = msg.sessionKey;
      if (msg.sessionKey && msg.sessionKey !== agentSessionKeyRef.current) return;
      applyAgentChanges(msg.files, msg.touched);
    } else if (msg.type === 'repo_suggestion') {
      setRepoSuggestion({ path: msg.path, repo: msg.repo });
    } else if (msg.type === 'error') {
      setAgentError(msg.message);
      setAgentMessages((prev) => [...prev, {
        id: agentMsgId.current++,
        role: 'status',
        text: msg.message,
      }]);
    }
  };

  const currentPath = useMemo(() => activePath || selected, [activePath, selected]);
  const activeRepo = useMemo(
    () => repos.find((item) => item.path === repoPath) || null,
    [repoPath, repos],
  );

  useEffect(() => {
    if (!addressFocus) setAddressDraft(currentPath || '');
  }, [currentPath, addressFocus]);

  const goToAddressPath = async (rawPath: string) => {
    const path = normalizeAddress(rawPath);
    if (!path) return;
    try {
      const info = await api<FsStatResponse>(`/api/fs/stat?path=${encodeURIComponent(path)}`);
      const target = info.path;
      let dir = info.kind === 'dir';
      if (info.kind === 'symlink') {
        try {
          await api<FsListResponse>(`/api/fs/list?path=${encodeURIComponent(target)}`);
          dir = true;
        } catch {
          dir = false;
        }
      }
      if (dir) await openFolder(target);
      else await openFile({ name: basename(target), path: target, kind: 'file' });
      await revealInTree(target);
      setAddressDraft(target);
      addressRef.current?.blur();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      showToast(raw.includes('ENOENT') ? 'Path not found' : raw);
    }
  };

  const goToAddress = async () => {
    await goToAddressPath(addressDraft);
  };

  const closeTabs = (paths: string[], keepPath: string | null) => {
    const closing = new Set(paths);
    const pick = (rest: OpenTab[], preferred: string | null) => (preferred && rest.some((tab) => tab.path === preferred)
      ? preferred
      : rest[rest.length - 1]?.path || null);
    // Read the panes before the state update: the replacer below runs later, and
    // by then the refs are already new.
    const previousLeft = activePathRef.current;
    const previousRight = splitPathRef.current;
    const next = tabsRef.current.filter((tab) => !closing.has(tab.path));
    // Both panes are repaired here. Closing a tab used to leave the right pane
    // pointing at a file that no longer existed, which rendered as an empty pane.
    const keptLeft = pick(next, keepPath ?? previousLeft);
    const keptRight = previousRight && !closing.has(previousRight)
      ? previousRight
      : pick(next, next.find((tab) => tab.path !== keptLeft)?.path || null);
    if (keptLeft !== previousLeft) setActivePath(keptLeft);
    if (keptRight !== previousRight) setSplitPath(keptRight);
    setTabs((prev) => prev.filter((tab) => !closing.has(tab.path)));
  };

  /** The editor renders twice when split: one element, two active files.
   *  Both panes therefore share tabs, dirty state and disk reloads, which is
   *  what splitting an editor has to mean. */
  const renderEditor = (over: Partial<Parameters<typeof EditorArea>[0]> = {}) => (
    <EditorArea
      tabs={tabs}
      activePath={activePath}
      onSelect={setActivePath}
      onCloseMany={closeTabs}
      onClose={(path) => {
        setTabs((prev) => {
          const rest = prev.filter((tab) => tab.path !== path);
          if (activePathRef.current === path) {
            setActivePath(rest[rest.length - 1]?.path || null);
          }
          return rest;
        });
      }}
      onChange={(path, content) => {
        const reviewTab = tabsRef.current.find((tab) => tab.path === path && tab.agentPath);
        if (reviewTab && !reviewEditedSent.current.has(path)) {
          // Told once per file: the record says "you edited it", and
          // repeating it every keystroke would bury the real signal.
          reviewEditedSent.current.add(path);
          sendAgent({ type: 'review_edited', path });
        }
        setTabs((prev) => prev.map((tab) => tab.path === path ? {
          ...tab,
          content,
          // Editing an agent review keeps the green side in step with
          // the text, so the diff shows the edit rather than the
          // agent's original proposal.
          after: tab.agentPath ? content : tab.after,
          dirty: content !== tab.savedContent,
          temp: tab.temp && content === tab.savedContent,
        } : tab));
      }}
      onSave={(path) => void save(path)}
      onRevert={(path) => void revertFile(path)}
      canRevert={(path) => Boolean(git?.files.some((item) => item.path === path))}
      onKeepTab={(path) => {
        setTabs((prev) => prev.map((tab) => tab.path === path ? { ...tab, temp: false } : tab));
        setActivePath(path);
      }}
      onRunInTerminal={runInTerminal}
      onRevealInTree={(path) => void revealInTree(path)}
      onAcceptChange={(path) => sendAgent({ type: 'accept', path })}
      onUndoChange={(path) => sendAgent({ type: 'undo', path })}
      onToggleView={applyViewMode}
      listings={listings}
      favorites={favorites}
      repos={repos}
      onOpenFile={(entry) => void openFile(entry)}
      onOpenFolder={navigateFolder}
      onOpenFolderNew={(path) => void openFolder(path, { newTab: true })}
      onCreate={(dir, kind, name) => void createNode(dir, kind, name)}
      onRename={(from, name) => void renameNode(from, name)}
      onDelete={(entry) => void deleteNode(entry)}
      onDeleteMany={(entries) => void deleteMany(entries)}
      onTerminal={openTerminalHere}
      onPin={(path) => void pinFolder(path)}
      onUnpin={(path) => void unpinFolder(path)}
      onAddRepo={(path) => void addRepo(path)}
      onRemoveRepo={(path) => void removeRepo(path)}
      onCopyFiles={copyFiles}
      onPasteFiles={(into) => void pasteFiles(into)}
      onLoadDir={loadDir}
      onHunkDecision={(path, id, decision) => sendAgent({ type: 'hunk', path, id, decision })}
      onOpenPath={(path) => {
        const tab = tabsRef.current.find((item) => item.path === path);
        if (tab) setTabs((prev) => prev.map((item) => item.path === path ? { ...item, agentPath: undefined } : item));
      }}
      {...over}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={() => {
            setHostOpen(false);
            setVersionOpen((v) => !v);
          }}
          title="Version, channels and windows"
        >
          <span className="brand-mark" />
          <span className="brand-name">RemotePad</span>
          <span className="brand-version">{meta.version ? `v${meta.version}` : ''}</span>
        </button>
        <UpdateButton onToast={showToast} />
        <div
          className={`path ${addressDropOver ? 'drop-over' : ''}`}
          onDragOver={(e) => {
            if (!hasEntryDrag(e)) return;
            e.preventDefault();
            setAddressDropOver(true);
          }}
          onDragLeave={() => setAddressDropOver(false)}
          onDrop={(e) => {
            setAddressDropOver(false);
            const entry = readEntryDrag(e);
            if (!entry) return;
            e.preventDefault();
            if (entry.kind === 'dir') {
              setAddressDraft(entry.path);
              void goToAddressPath(entry.path);
              return;
            }
            window.open(browserPadUrl(entry.path), '_blank', 'noopener,noreferrer');
          }}
        >
          {activeRepo && (
            <button
              type="button"
              className="ws-chip"
              title={`Open ${activeRepo.path} — same as clicking it in REPOS`}
              onClick={() => {
                // Identical to a REPOS row: make it the repo, show that tab, and
                // point the tree at it.
                setRepoPath(activeRepo.path);
                setSideTab('repos');
                void revealDir(activeRepo.path);
              }}
            >{activeRepo.name}</button>
          )}
          <input
            ref={addressRef}
            className="path-input"
            value={addressDraft}
            spellCheck={false}
            placeholder="Path · drop a file to open a tree + editor window"
            onFocus={(e) => {
              setAddressFocus(true);
              e.currentTarget.select();
            }}
            onBlur={() => setAddressFocus(false)}
            onChange={(e) => setAddressDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void goToAddress();
              }
              if (e.key === 'Escape') {
                setAddressDraft(currentPath || '');
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        {!padMode && (
        <button
          type="button"
          className={`term-toggle ${termOpen ? 'on' : ''}`}
          title={termOpen ? 'Hide terminal (Ctrl/⌘+`)' : 'Show terminal (Ctrl/⌘+`)'}
          onClick={() => setTermOpen((v) => !v)}
        >Terminal</button>
        )}
        {machine && (
          <button
            type="button"
            className="host-btn"
            onClick={() => { setHostOpen((v) => !v); setVersionOpen(false); }}
          >
            {machine.user}@{machine.hostname}
          </button>
        )}
      </header>
      <div className="shell">
        <PanelGroup
          direction="horizontal"
          ref={colsGroup}
          onLayout={(layout) => {
            if (!sizesGate.current) return;
            setSizes((prev) => ({ ...prev, cols: layout }));
          }}
        >
          <Panel defaultSize={14} minSize={7}>
            <LeftSidebar
              roots={[treeRoot]}
              treeRoot={treeRoot}
              selected={selected}
              revealTick={revealTick}
              expanded={expanded}
              listings={listings}
              favorites={favorites}
              repos={repos}
              repoPath={repoPath}
              sideTab={sideTab}
              onSideTab={setSideTab}
              onSelect={(path) => setSelected(path)}
              onToggle={(path) => void toggleDir(path)}
              onOpen={(entry, temp) => void openFile(entry, { temp })}
              onBrowse={(entry) => void openFolder(entry.path)}
              onBrowseNew={(entry) => void openFolder(entry.path, { newTab: true })}
              onCreate={(dir, kind, name) => void createNode(dir, kind, name)}
              onRename={(from, name) => void renameNode(from, name)}
              onDelete={(entry) => void deleteNode(entry)}
              onTerminal={openTerminalHere}
              onPin={(path) => void pinFolder(path)}
              onUnpin={(path) => void unpinFolder(path)}
              onAddRepo={(path) => void addRepo(path)}
              onRemoveRepo={(path) => void removeRepo(path)}
              onReveal={(path, asRepo) => {
                if (asRepo) {
                  setRepoPath(path);
                  setSideTab('repos');
                }
                void revealDir(path);
              }}
              onClearRepo={() => void clearRepo()}
              onGoUp={() => void goUp()}
              onOpenControl={() => {
                if (!controlPath) return;
                void openFile({ name: basename(controlPath), path: controlPath, kind: 'file' });
              }}
              onRunStartup={runStartup}
              onReorderFavorites={(paths) => void reorderFavorites(paths)}
              onReorderRepos={(paths) => void reorderRepos(paths)}
              onCopyFiles={copyFiles}
              onPasteFiles={(into) => void pasteFiles(into)}
              pendingPaths={pendingPaths}
            />
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel minSize={20}>
            <div className="main-col">
            <PanelGroup
              direction="vertical"
              className="main-split"
              ref={mainGroup}
              onLayout={(layout) => {
                if (!sizesGate.current) return;
                setSizes((prev) => ({ ...prev, main: layout }));
              }}
            >
              <Panel>
                <div className={`editor-split${splitPath ? ' split' : ''}`}>
                  <div
                    className={`editor-pane${focusedPane === 'left' ? ' focused' : ''}`}
                    style={splitPath ? { flex: `0 0 ${(splitRatio * 100).toFixed(2)}%` } : undefined}
                    onMouseDownCapture={() => setFocusedPane('left')}
                    onDragOver={(e) => {
                      if (hasEntryDrag(e)) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      const entry = readEntryDrag(e);
                      if (!entry || entry.kind !== 'file') return;
                      e.preventDefault();
                      // Mirror of the right pane: swap in another tab rather than
                      // closing the split or leaving the other side empty.
                      if (splitPathRef.current === entry.path) {
                        const next = tabsRef.current.find((tab) => tab.path !== entry.path);
                        setSplitPath(next?.path || null);
                      }
                      setActivePath(entry.path);
                      setFocusedPane('left');
                    }}
                  >
                    {renderEditor({
                      showActions: !splitPath,
                      splitOpen: Boolean(splitPath),
                      onToggleSplit: () => {
                        if (splitPath) {
                          setSplitPath(null);
                          setFocusedPane('left');
                          return;
                        }
                        // Fill the new pane with a different tab so the split is
                        // useful at once, and leave the focus where the reader
                        // left it: they have not clicked into the right pane yet.
                        const current = activePathRef.current;
                        const other = tabsRef.current.find((tab) => tab.path !== current);
                        const target = other?.path || current;
                        if (!target) return;
                        setSplitPath(target);
                      },
                    })}
                  </div>
                  {splitPath && (
                    <div
                      className="editor-divider"
                      role="separator"
                      aria-orientation="vertical"
                      title="Drag to resize · double-click for 50/50"
                      onPointerDown={(e) => {
                        const container = e.currentTarget.parentElement;
                        if (!container) return;
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                        const box = container.getBoundingClientRect();
                        const move = (ev: PointerEvent) => {
                          const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - box.left) / box.width));
                          splitRatioRef.current = ratio;
                          setSplitRatio(ratio);
                        };
                        const stop = () => {
                          window.removeEventListener('pointermove', move);
                          window.removeEventListener('pointerup', stop);
                          // One save per drag, not one per pixel.
                          putSession(false);
                        };
                        window.addEventListener('pointermove', move);
                        window.addEventListener('pointerup', stop);
                      }}
                      onDoubleClick={() => {
                        splitRatioRef.current = 0.5;
                        setSplitRatio(0.5);
                        putSession(false);
                      }}
                    />
                  )}
                  {splitPath && (
                    <div
                      className={`editor-pane secondary${focusedPane === 'right' ? ' focused' : ''}`}
                      onMouseDownCapture={() => setFocusedPane('right')}
                      // Drag a tab or a tree file here and it opens in this pane,
                      // the way a split works in Cursor: the tab moves, it does
                      // not get duplicated on the other side.
                      onDragOver={(e) => {
                        if (hasEntryDrag(e)) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        const entry = readEntryDrag(e);
                        if (!entry || entry.kind !== 'file') return;
                        e.preventDefault();
                        // A move, not a copy: hand the left pane something else so
                        // the same file is not shown twice. With nothing else open
                        // the left keeps it — two panes on one file beats a blank.
                        if (activePathRef.current === entry.path) {
                          const next = tabsRef.current.find((tab) => tab.path !== entry.path);
                          if (next) setActivePath(next.path);
                        }
                        setSplitPath(entry.path);
                        setFocusedPane('right');
                      }}
                    >
                      {renderEditor({
                        activePath: splitPath,
                        onSelect: setSplitPath,
                        hideChrome: true,
                        onCloseSplit: () => {
                          setSplitPath(null);
                          setFocusedPane('left');
                        },
                      })}
                    </div>
                  )}
                </div>
              </Panel>
              {termOpen && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel defaultSize={28} minSize={12}>
                    <TerminalPanel
                      sessions={sessions}
                      activeId={activeTerm}
                      onSelect={setActiveTerm}
                      onCreate={createDefaultTerminal}
                      onRename={(id, name) => sendTerm({ type: 'rename', id, name })}
                      onClose={(id) => sendTerm({ type: 'close', id })}
                      onInput={(id, data) => sendTerm({ type: 'input', id, data })}
                      onResize={(id, cols, rows) => sendTerm({ type: 'resize', id, cols, rows })}
                      onDataRef={termWrite}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
            </div>
          </Panel>
          {!padMode && <PanelResizeHandle className="resize-handle" />}
          {!padMode && (
          <Panel defaultSize={34} minSize={12} maxSize={72}>
            <RightDock
              cwd={agentWorkingCwd || agentCwd}
              error={agentError}
              sessionId={agentSessionId}
              agentSessions={agentSessions}
              state={agentState}
              backend={agentBackend}
              messages={agentMessages}
              changes={agentChanges}
              onSend={(text) => {
                const clean = text.trim();
                if (!clean) return;
                setAgentMessages((prev) => [...prev, { id: agentMsgId.current++, role: 'user', text: clean }]);
                sendAgent({ type: 'send', text: clean });
              }}
              onStop={() => {
                setAgentState('idle');
                sendAgent({ type: 'stop' });
              }}
              onSetBackend={(backend) => {
                // Clear only when the backend really changes. Clicking the active
                // tab used to wipe the pane, and ready then ignored its history
                // because the session had not changed — leaving an empty window.
                const changed = backend !== agentBackend;
                setAgentState('idle');
                setAgentSwitching(true);
                if (changed) {
                  setAgentMessages([]);
                  setCatscoList(undefined);
                }
                setAgentBackend(backend);
                agentBackendRef.current = backend;
                sendAgent({ type: 'set_backend', backend });
              }}
              onClear={() => {
                if (agentBackend === 'catsco') return;
                setAgentMessages([]);
                sendAgent({ type: 'clear' });
              }}
              onNew={() => {
                if (agentBackend === 'catsco') return;
                // No lock and no blanking: ready replaces the transcript within
                // ~100ms, and a locked composer on every switch felt like a hang.
                sendAgent({ type: 'new' });
              }}
              onOpenSession={(id) => {
                if (agentBackend === 'catsco') return;
                sendAgent({ type: 'open', id });
              }}
              onRenameSession={(id, title) => sendAgent({ type: 'rename', id, title })}
              onDeleteSession={(id) => {
                if (id === agentSessionId) setAgentMessages([]);
                sendAgent({ type: 'delete', id });
              }}
              onAccept={(path) => sendAgent({ type: 'accept', path })}
              onUndo={(path) => sendAgent({ type: 'undo', path })}
              onAcceptAll={() => sendAgent({ type: 'accept_all' })}
              onUndoAll={() => sendAgent({ type: 'undo_all' })}
              onOpenAgentDiff={openAgentDiff}
              onOpenSessionFile={(path) => {
                void openFile({ name: basename(path), path, kind: 'file' });
              }}
              catscoList={catscoList}
              onCatsCoSelect={(topicId) => {
                sendAgent({ type: 'catsco_select', topicId });
              }}
              onCatsCoRefresh={() => {
                setCatscoList(undefined);
                sendAgent({ type: 'catsco_refresh' });
              }}
              onCatsCoCreateProject={(name) => sendAgent({ type: 'catsco_project_create', name })}
              onCatsCoCreateTask={(name, projectId) => sendAgent({ type: 'catsco_task_create', name, projectId })}
              onCatsCoSwitchBot={(botUid) => {
                setAgentSwitching(true);
                setAgentMessages([]);
                sendAgent({ type: 'catsco_bot_switch', botUid });
              }}
              onCatsCoCloseActive={() => setAgentMessages([])}
              switching={agentSwitching}
              sessionRepos={sessionRepos}
              onRemoveSessionRepo={(target) => {
                const next = sessionRepos.filter((item) => item !== target);
                setSessionRepos(next);
                sendAgent({ type: 'repos_set', paths: next });
              }}
              repoSuggestion={repoSuggestion}
              onAnswerRepoSuggestion={(accept) => {
                const current = repoSuggestion;
                setRepoSuggestion(null);
                if (!current) return;
                if (accept) {
                  setSessionRepos((prev) => (prev.includes(current.repo) ? prev : [...prev, current.repo]));
                  sendAgent({ type: 'repos_add', path: current.repo });
                } else {
                  sendAgent({ type: 'repos_dismiss', path: current.path });
                }
              }}
            />
          </Panel>
          )}
        </PanelGroup>
      </div>
      {versionOpen && (
        <>
          <div className="float-mask" onClick={() => setVersionOpen(false)} />
          <VersionPop onClose={() => setVersionOpen(false)} currentWindow={win} />
        </>
      )}
      {hostOpen && (
        <>
          <div className="float-mask" onClick={() => setHostOpen(false)} />
          <HostPop
            path={currentPath}
            machine={machine}
            git={git}
            sessions={sessions}
            modules={moduleEnabled}
            onToggleModule={(id, on) => void toggleModule(id, on)}
            onOpenDiff={(path) => { setHostOpen(false); void openDiff(path); }}
            onSelectTerm={(id) => {
              setHostOpen(false);
              setTermOpen(true);
              setActiveTerm(id);
            }}
            onClose={() => setHostOpen(false)}
          />
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
      {clipMenu && (
        <TextClipMenu
          x={clipMenu.x}
          y={clipMenu.y}
          text={clipMenu.text}
          onClose={() => setClipMenu(null)}
        />
      )}
    </div>
  );
}

function normalizeAddress(raw: string): string {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith('file://')) {
    try { value = decodeURIComponent(value.slice('file://'.length)); }
    catch { value = value.slice('file://'.length); }
  }
  value = value.replace(/\\/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  if (value && !value.startsWith('/')) value = `/${value}`;
  return value;
}

function compactInput(input: unknown): string {
  try {
    const text = JSON.stringify(input);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return '';
  }
}

function upsertSession(list: TermSessionInfo[], session: TermSessionInfo): TermSessionInfo[] {
  const i = list.findIndex((item) => item.id === session.id);
  if (i < 0) return [...list, session];
  const next = list.slice();
  next[i] = session;
  return next;
}

function matchRepo(path: string, folders: Repo[]): Repo | null {
  let best: Repo | null = null;
  for (const item of folders) {
    if (path === item.path || path.startsWith(item.path + '/')) {
      if (!best || item.path.length > best.path.length) best = item;
    }
  }
  return best;
}

function startupText(repo: Repo | null): string {
  if (!repo?.startup?.length) return '';
  return repo.startup.map((line) => line.endsWith('\n') ? line : `${line}\n`).join('');
}

function dirsToExpand(filePath: string, root: string): string[] {
  const out: string[] = [];
  let cur = filePath;
  while (true) {
    const dir = dirname(cur);
    if (!dir || dir === cur) {
      if (root === '/' && !out.includes('/')) out.unshift('/');
      break;
    }
    out.unshift(dir);
    if (dir === root) break;
    cur = dir;
  }
  if (!out.includes(root)) out.unshift(root);
  return out;
}

async function readTab(filePath: string, viewMode?: OpenTab['viewMode'], folder?: boolean, enabled?: ViewerEnabledMap): Promise<OpenTab | null> {
  if (!filePath || filePath.startsWith('diff:') || filePath.startsWith('agent:')) return null;
  if (folder) {
    return {
      path: filePath,
      name: basename(filePath) || '/',
      content: '',
      savedContent: '',
      binary: false,
      viewMode: viewMode === 'details' ? 'details' : 'icons',
      dirty: false,
      loading: false,
      kind: 'folder',
    };
  }
  const kind = viewerKind(filePath, enabled);
  const tab: OpenTab = {
    path: filePath,
    name: basename(filePath),
    content: '',
    savedContent: '',
    binary: false,
    viewMode: viewMode === 'source' || viewMode === 'rendered'
      ? viewMode
      : (hasRenderedView(kind) ? 'rendered' : 'source'),
    dirty: false,
    loading: false,
    kind,
  };
  try {
    if (kind === 'image') return { ...tab, binary: true };
    const file = await api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
    return {
      ...tab,
      content: file.binary ? '' : file.content,
      savedContent: file.binary ? '' : file.content,
      binary: file.binary,
    };
  } catch {
    return null;
  }
}
