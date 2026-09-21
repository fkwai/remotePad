import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { AgentChange, AgentClientMessage, AgentServerMessage, AgentSessionInfo, AgentStatus, Favorite, FsEntry, FsListResponse, FsReadResponse, FsStatResponse, GitDiffResponse, GitStatusResponse, MachineInfo, Repo, ReposResponse, SessionState, TermClientMessage, TermPlotInfo, TermServerMessage, TermSessionInfo, WatchServerMessage } from '@remotepad/shared';
import { api } from './api';
import { basename, dirname, hasRenderedView, viewerKind } from './files';
import { prepareRunText } from './runSelection';
import { browserFileUrl, hasEntryDrag, readEntryDrag } from './dnd';
import { LeftSidebar, type SideTab } from './components/LeftSidebar';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { TerminalPanel } from './components/TerminalPanel';
import { RightDock } from './components/RightDock';
import { TextClipMenu } from './components/ContextMenu';
import { HelpPop, HostPop } from './components/Popovers';
import type { AgentChatMessage } from './components/AgentPanel';

export function App() {
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
  const [termOpen, setTermOpen] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [controlPath, setControlPath] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('favorites');
  const [helpOpen, setHelpOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [addressFocus, setAddressFocus] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [agentChanges, setAgentChanges] = useState<AgentChange[]>([]);
  const [agentState, setAgentState] = useState<AgentStatus>('idle');
  const [agentError, setAgentError] = useState<string | undefined>();
  const [agentSessionId, setAgentSessionId] = useState<string | undefined>();
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [agentWorkingCwd, setAgentWorkingCwd] = useState('');
  const [termPlots, setTermPlots] = useState<TermPlotInfo[]>([]);
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
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const sideTabRef = useRef(sideTab);
  sideTabRef.current = sideTab;
  const termOpenRef = useRef(termOpen);
  termOpenRef.current = termOpen;
  const agentMsgId = useRef(1);
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

  const restoreTabs = useCallback(async (items: SessionState['tabs'], active: string | null) => {
    const loaded: OpenTab[] = [];
    for (const item of items) {
      const tab = await readTab(item.path, item.viewMode, item.folder);
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
        const [favs, listed, session] = await Promise.all([
          api<{ folders: Favorite[] }>('/api/favorites').catch(() => ({ folders: [] as Favorite[] })),
          api<ReposResponse>('/api/repos').catch(() => ({ repos: [] as Repo[], controlPath: '' })),
          api<SessionState>('/api/session').catch(() => null),
        ]);
        if (cancelled) return;
        setFavorites(favs.folders);
        setRepos(listed.repos);
        if (listed.controlPath) setControlPath(listed.controlPath);
        const tree = session?.treeRoot || '/';
        const activeRepo = session?.repoPath && listed.repos.some((item) => item.path === session.repoPath)
          ? session.repoPath
          : null;
        setRepoPath(activeRepo);
        setTreeRoot(tree);
        setSelected(session?.selected || tree);
        setSideTab(session?.sideTab === 'repos' ? 'repos' : 'favorites');
        setTermOpen(session ? session.termOpen : false);
        const expandedDirs = session?.expanded?.length ? session.expanded : [tree];
        setExpanded(new Set(expandedDirs));
        await loadDir(tree);
        for (const dir of expandedDirs) await loadDir(dir);
        if (session?.tabs?.length) await restoreTabs(session.tabs, session.activePath);
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
  }), [repoPath, treeRoot, selected, expanded, tabs, activePath, sideTab, termOpen]);

  const putSession = (keepalive = false) => {
    const body = JSON.stringify({
      repoPath: repoPathRef.current,
      treeRoot: treeRootRef.current,
      selected: selectedRef.current,
      expanded: [...expandedRef.current],
      tabs: tabsRef.current
        .filter((tab) => tab.kind !== 'diff' && !tab.agentPath && !tab.temp)
        .map((tab) => ({ path: tab.path, viewMode: tab.viewMode, folder: tab.kind === 'folder' })),
      activePath: activePathRef.current,
      sideTab: sideTabRef.current,
      termOpen: termOpenRef.current,
      rightTab: 'agent' as const,
    } satisfies SessionState);
    if (keepalive) {
      void fetch('/api/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
      return;
    }
    void api('/api/session', { method: 'PUT', body }).catch(() => undefined);
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
          if (msg.termId) {
            setTermPlots((prev) => {
              const next = prev.filter((item) => item.path !== msg.path);
              next.push({
                path: msg.path,
                title: msg.title || basename(msg.path),
                termId: msg.termId!,
                at: Date.now(),
              });
              return next;
            });
          }
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
          setTermPlots((prev) => {
            const doomed = prev.filter((item) => item.termId === msg.id).map((item) => item.path);
            if (doomed.length) {
              setTabs((tabs) => {
                const rest = tabs.filter((tab) => !doomed.includes(tab.path));
                if (doomed.includes(activePathRef.current || '')) {
                  setActivePath(rest[rest.length - 1]?.path || null);
                }
                return rest;
              });
            }
            return prev.filter((item) => item.termId !== msg.id);
          });
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
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent`);
      agentWs.current = ws;
      ws.onopen = () => {
        const cwd = repoPathRef.current || treeRootRef.current;
        ws.send(JSON.stringify({ type: 'hello', cwd } satisfies AgentClientMessage));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as AgentServerMessage;
        handleAgentEventRef.current(msg);
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
      agentWs.current?.close();
    };
  }, []);

  useEffect(() => {
    const cwd = repoPath || treeRoot;
    if (agentWs.current?.readyState === WebSocket.OPEN) {
      agentWs.current.send(JSON.stringify({ type: 'hello', cwd } satisfies AgentClientMessage));
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

  const openFile = async (entry: FsEntry, opts?: { temp?: boolean; reload?: boolean }) => {
    if (entry.kind === 'dir') {
      await toggleDir(entry.path);
      return;
    }
    const keep = !opts?.temp;
    const existing = tabsRef.current.find((tab) => tab.path === entry.path);
    if (existing && !opts?.reload) {
      if (keep && existing.temp) {
        setTabs((prev) => prev.map((tab) => tab.path === entry.path ? { ...tab, temp: false } : tab));
      }
      setActivePath(entry.path);
      return;
    }
    const kind = viewerKind(entry.path);
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
          const rest = prev.filter((item) => !item.temp);
          return [tab, ...rest];
        }
        return [...prev, tab];
      });
    } else {
      setTabs((prev) => prev.map((tab) => tab.path === entry.path
        ? { ...tab, loading: true, error: undefined, temp: keep ? false : tab.temp }
        : tab));
    }
    setActivePath(entry.path);
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
    const same = current.find((tab) => tab.kind === 'folder' && tab.path === dir);
    if (same) {
      setActivePath(dir);
      return;
    }
    const reuse = opts?.newTab
      ? undefined
      : (
        (opts?.from ? current.find((tab) => tab.kind === 'folder' && tab.path === opts.from) : undefined)
        || current.find((tab) => tab.kind === 'folder' && tab.path === activePathRef.current)
        || current.find((tab) => tab.kind === 'folder')
      );
    const mode = opts?.viewMode === 'details' || opts?.viewMode === 'icons'
      ? opts.viewMode
      : (reuse?.viewMode === 'details' ? 'details' : 'icons');
    if (reuse) {
      setTabs((prev) => prev.map((tab) => tab.kind === 'folder' && tab.path === reuse.path
        ? { ...tab, path: dir, name, viewMode: mode }
        : tab));
      setActivePath(dir);
      return;
    }
    setTabs((prev) => [...prev, {
      path: dir,
      name,
      content: '',
      savedContent: '',
      binary: false,
      viewMode: mode,
      dirty: false,
      loading: false,
      kind: 'folder',
    }]);
    setActivePath(dir);
  };

  const navigateFolder = (from: string, to: string) => {
    void openFolder(to, { from });
  };

  const save = async (path: string) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab || tab.binary || tab.kind === 'diff' || tab.kind === 'folder') return;
    await api('/api/fs/write', { method: 'PUT', body: JSON.stringify({ path, content: tab.content }) });
    setTabs((prev) => prev.map((item) => item.path === path ? { ...item, savedContent: item.content, dirty: false, temp: false } : item));
    if (controlPathRef.current && path === controlPathRef.current) void reloadRepos();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activePathRef.current) void save(activePathRef.current);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setTermOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    const payload = prepareRunText(text, activePathRef.current);
    if (!payload) return;
    setTermOpen(true);
    const hint = activePathRef.current || selectedRef.current || treeRootRef.current;
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
    setTabs((prev) => [...prev.filter((item) => item.path !== id), tab]);
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
    const id = `agent:${change.path}`;
    const tab: OpenTab = {
      path: id,
      name: `${basename(change.path)} (${change.kind})`,
      content: change.diff,
      savedContent: change.diff,
      binary: false,
      viewMode: 'source',
      dirty: false,
      loading: false,
      kind: 'diff',
      diff: change.diff,
      agentPath: change.path,
    };
    setTabs((prev) => [...prev.filter((item) => item.path !== id), tab]);
    setActivePath(id);
  };

  const applyAgentChanges = (files: AgentChange[], touched?: string[]) => {
    setAgentChanges(files);
    const pending = new Set(files.map((item) => item.path));
    setTabs((prev) => prev
      .filter((tab) => !tab.agentPath || pending.has(tab.agentPath))
      .map((tab) => {
        if (!tab.agentPath) return tab;
        const change = files.find((item) => item.path === tab.agentPath);
        if (!change) return tab;
        return { ...tab, diff: change.diff, content: change.diff, savedContent: change.diff };
      }));
    if (touched?.length) void reloadTouched(touched);
  };

  handleAgentEventRef.current = (msg) => {
    if (msg.type === 'ready') {
      setAgentError(msg.error);
      setAgentSessionId(msg.sessionId);
      if (msg.cwd) setAgentWorkingCwd(msg.cwd);
      if (msg.sessions) setAgentSessions(msg.sessions);
      setAgentChanges(msg.changes);
      if (msg.history) {
        setAgentMessages(msg.history.map((item) => ({
          id: agentMsgId.current++,
          role: item.role,
          text: item.text,
          name: item.name,
        })));
      }
      setAgentState((prev) => {
        if (msg.error) return 'error';
        return prev === 'running' ? prev : 'idle';
      });
    } else if (msg.type === 'sessions') {
      setAgentSessions(msg.sessions);
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
      const detail = msg.input ? compactInput(msg.input) : '';
      setAgentMessages((prev) => [...prev, {
        id: agentMsgId.current++,
        role: 'tool',
        name: msg.name,
        text: detail,
      }]);
    } else if (msg.type === 'status') {
      setAgentState(msg.state);
      if (msg.message === 'cleared' || msg.message === 'new') setAgentMessages([]);
    } else if (msg.type === 'changes') {
      applyAgentChanges(msg.files, msg.touched);
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
    setTabs((prev) => {
      const rest = prev.filter((tab) => !closing.has(tab.path));
      const keep = keepPath && rest.some((tab) => tab.path === keepPath)
        ? keepPath
        : rest[rest.length - 1]?.path || null;
      if (activePathRef.current !== keep) setActivePath(keep);
      return rest;
    });
  };

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => { setHelpOpen((v) => !v); setHostOpen(false); }}>
          <span className="brand-mark" /> RemotePad
        </button>
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
            window.open(browserFileUrl(entry.path), '_blank', 'noopener,noreferrer');
          }}
        >
          {activeRepo && <span className="ws-chip">{activeRepo.name}</span>}
          <input
            ref={addressRef}
            className="path-input"
            value={addressDraft}
            spellCheck={false}
            placeholder="Path · drop a file to open in the browser"
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
        {machine && (
          <button
            type="button"
            className="host-btn"
            onClick={() => { setHostOpen((v) => !v); setHelpOpen(false); }}
          >
            {machine.user}@{machine.hostname}
          </button>
        )}
      </header>
      <div className="shell">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={22} minSize={14}>
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
              pendingPaths={pendingPaths}
            />
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel>
            <div className="main-col">
            <PanelGroup direction="vertical" className="main-split">
              <Panel>
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
                    setTabs((prev) => prev.map((tab) => tab.path === path ? {
                      ...tab,
                      content,
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
                  onToggleView={(path, mode) => {
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
                  }}
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
                  onLoadDir={loadDir}
                />
              </Panel>
              {termOpen && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel defaultSize={28} minSize={12}>
                    <TerminalPanel
                      sessions={sessions}
                      activeId={activeTerm}
                      plots={termPlots}
                      onSelect={setActiveTerm}
                      onCreate={createDefaultTerminal}
                      onRename={(id, name) => sendTerm({ type: 'rename', id, name })}
                      onClose={(id) => sendTerm({ type: 'close', id })}
                      onInput={(id, data) => sendTerm({ type: 'input', id, data })}
                      onResize={(id, cols, rows) => sendTerm({ type: 'resize', id, cols, rows })}
                      onOpenPlot={(path) => {
                        void openFile({ name: basename(path), path, kind: 'file' }, { reload: true });
                      }}
                      onDataRef={termWrite}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={34} minSize={22} maxSize={72}>
            <RightDock
              cwd={agentWorkingCwd || agentCwd}
              error={agentError}
              sessionId={agentSessionId}
              agentSessions={agentSessions}
              state={agentState}
              messages={agentMessages}
              changes={agentChanges}
              onSend={(text) => {
                const clean = text.trim();
                if (!clean) return;
                setAgentMessages((prev) => [...prev, { id: agentMsgId.current++, role: 'user', text: clean }]);
                sendAgent({ type: 'send', text: clean });
              }}
              onStop={() => sendAgent({ type: 'stop' })}
              onClear={() => {
                setAgentMessages([]);
                sendAgent({ type: 'clear' });
              }}
              onNew={() => {
                setAgentMessages([]);
                sendAgent({ type: 'new' });
              }}
              onOpenSession={(id) => {
                setAgentMessages([]);
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
            />
          </Panel>
        </PanelGroup>
      </div>
      {helpOpen && (
        <>
          <div className="float-mask" onClick={() => setHelpOpen(false)} />
          <HelpPop onClose={() => setHelpOpen(false)} />
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

async function readTab(filePath: string, viewMode?: OpenTab['viewMode'], folder?: boolean): Promise<OpenTab | null> {
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
  const kind = viewerKind(filePath);
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
