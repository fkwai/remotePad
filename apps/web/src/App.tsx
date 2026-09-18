import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Favorite, FsEntry, FsListResponse, FsReadResponse, GitDiffResponse, GitStatusResponse, MachineInfo, SessionState, TermClientMessage, TermServerMessage, TermSessionInfo, WatchServerMessage, Workspace, WorkspacesResponse } from '@remotepad/shared';
import { api } from './api';
import { basename, dirname, hasRenderedView, viewerKind } from './files';
import { LeftSidebar, type SideTab } from './components/LeftSidebar';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { TerminalPanel } from './components/TerminalPanel';
import { InfoPanel } from './components/InfoPanel';
import { TextClipMenu } from './components/ContextMenu';

export function App() {
  const [treeRoot, setTreeRoot] = useState('/');
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Record<string, FsEntry[]>>({});
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TermSessionInfo[]>([]);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatusResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(true);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [controlPath, setControlPath] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('favorites');
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; text: string } | null>(null);

  const termWs = useRef<WebSocket | null>(null);
  const watchWs = useRef<WebSocket | null>(null);
  const termWrite = useRef<(id: string, data: string) => void>(() => undefined);
  const pendingAttach = useRef<string[]>([]);
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
  sessionsRef.current = sessions;
  const treeRootRef = useRef(treeRoot);
  treeRootRef.current = treeRoot;
  const pendingRun = useRef<{ setup: string; text: string } | null>(null);
  const pendingAfterStartup = useRef<{ id: string; text: string } | null>(null);
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const controlPathRef = useRef(controlPath);
  controlPathRef.current = controlPath;
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const sideTabRef = useRef(sideTab);
  sideTabRef.current = sideTab;
  const termOpenRef = useRef(termOpen);
  termOpenRef.current = termOpen;
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
    const files = items.filter((item) => !item.folder);
    const folders = items.filter((item) => item.folder);
    const folder = folders.find((item) => item.path === active) || folders[folders.length - 1];
    const ordered = folder ? [...files, folder] : files;
    const loaded: OpenTab[] = [];
    for (const item of ordered) {
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
        const [favs, ws, session] = await Promise.all([
          api<{ folders: Favorite[] }>('/api/favorites').catch(() => ({ folders: [] as Favorite[] })),
          api<WorkspacesResponse>('/api/workspaces').catch(() => ({ folders: [] as Workspace[], controlPath: '' })),
          api<SessionState>('/api/session').catch(() => null),
        ]);
        if (cancelled) return;
        setFavorites(favs.folders);
        setWorkspaces(ws.folders);
        if (ws.controlPath) setControlPath(ws.controlPath);
        const tree = session?.treeRoot || '/';
        const wsPath = session?.workspacePath && ws.folders.some((item) => item.path === session.workspacePath)
          ? session.workspacePath
          : null;
        setWorkspacePath(wsPath);
        setTreeRoot(tree);
        setSelected(session?.selected || tree);
        setSideTab(session?.sideTab === 'workspace' ? 'workspace' : 'favorites');
        setTermOpen(true);
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
    workspacePath,
    treeRoot,
    selected,
    expanded: [...expanded].sort(),
    tabs: tabs
      .filter((tab) => tab.kind !== 'diff')
      .map((tab) => ({ path: tab.path, viewMode: tab.viewMode, folder: tab.kind === 'folder' })),
    activePath,
    sideTab,
  }), [workspacePath, treeRoot, selected, expanded, tabs, activePath, sideTab]);

  const putSession = (keepalive = false) => {
    const body = JSON.stringify({
      workspacePath: workspacePathRef.current,
      treeRoot: treeRootRef.current,
      selected: selectedRef.current,
      expanded: [...expandedRef.current],
      tabs: tabsRef.current
        .filter((tab) => tab.kind !== 'diff')
        .map((tab) => ({ path: tab.path, viewMode: tab.viewMode, folder: tab.kind === 'folder' })),
      activePath: activePathRef.current,
      sideTab: sideTabRef.current,
      termOpen: termOpenRef.current,
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
        if (msg.type !== 'change') return;
        const current = listingsRef.current;
        const dir = dirname(msg.path);
        if (current[msg.path]) void loadDir(msg.path);
        else if (current[dir]) void loadDir(dir);
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
          const mine = pendingAttach.current;
          if (!mine.length) {
            setSessions([]);
            setActiveTerm(null);
            return;
          }
          const live = msg.sessions.filter((item) => mine.includes(item.id));
          setSessions(live);
          for (const item of live) sendTerm({ type: 'attach', id: item.id });
          setActiveTerm((cur) => (cur && live.some((item) => item.id === cur) ? cur : live[0]?.id || null));
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
                window.setTimeout(() => {
                  const wait = pendingAfterStartup.current;
                  if (wait && wait.id === id) {
                    pendingAfterStartup.current = null;
                    sendTerm({ type: 'input', id, data: wait.text });
                  }
                }, 2500);
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
    pendingAttach.current = sessions.map((item) => item.id);
  }, [sessions]);

  useEffect(() => {
    const path = selected;
    if (!path) return;
    const handle = window.setTimeout(() => {
      api<GitStatusResponse>(`/api/git/status?path=${encodeURIComponent(path)}`)
        .then(setGit)
        .catch(() => setGit(null));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [selected]);

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
    await revealDir(parent);
  };

  const clearWorkspace = async () => {
    setWorkspacePath(null);
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

  const addWorkspace = async (dir: string) => {
    try {
      const res = await api<WorkspacesResponse>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ path: dir }),
      });
      setWorkspaces(res.folders);
      setControlPath(res.controlPath);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const removeWorkspace = async (dir: string) => {
    try {
      const res = await api<WorkspacesResponse>(`/api/workspaces?path=${encodeURIComponent(dir)}`, {
        method: 'DELETE',
      });
      setWorkspaces(res.folders);
      setControlPath(res.controlPath);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const reloadWorkspaces = async () => {
    try {
      const res = await api<WorkspacesResponse>('/api/workspaces');
      setWorkspaces(res.folders);
      setControlPath(res.controlPath);
    } catch {
      // ignore
    }
  };

  const openFile = async (entry: FsEntry) => {
    if (entry.kind === 'dir') {
      await toggleDir(entry.path);
      return;
    }
    const existing = tabs.find((tab) => tab.path === entry.path);
    if (existing) {
      setActivePath(entry.path);
      return;
    }
    const kind = viewerKind(entry.path);
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
    };
    setTabs((prev) => [...prev, tab]);
    setActivePath(entry.path);
    try {
      if (kind === 'image') {
        setTabs((prev) => prev.map((item) => item.path === entry.path ? { ...item, loading: false, binary: true } : item));
        return;
      }
      const file = await api<FsReadResponse>(`/api/fs/read?path=${encodeURIComponent(entry.path)}`);
      setTabs((prev) => prev.map((item) => item.path === entry.path ? {
        ...item,
        loading: false,
        content: file.binary ? '' : file.content,
        savedContent: file.binary ? '' : file.content,
        binary: file.binary,
      } : item));
    } catch (err) {
      setTabs((prev) => prev.map((item) => item.path === entry.path ? {
        ...item,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      } : item));
    }
  };

  const openFolder = async (dir: string, viewMode?: OpenTab['viewMode']) => {
    await loadDir(dir);
    const existing = tabsRef.current.find((tab) => tab.kind === 'folder');
    const mode = viewMode === 'details' || viewMode === 'icons'
      ? viewMode
      : (existing?.viewMode === 'details' ? 'details' : 'icons');
    if (existing) {
      setTabs((prev) => prev.map((tab) => tab.kind === 'folder'
        ? { ...tab, path: dir, name: 'Explorer', viewMode: mode }
        : tab));
      setActivePath(dir);
      return;
    }
    setTabs((prev) => [...prev, {
      path: dir,
      name: 'Explorer',
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

  const navigateFolder = (_from: string, to: string) => {
    void openFolder(to);
  };

  const save = async (path: string) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab || tab.binary || tab.kind === 'diff' || tab.kind === 'folder') return;
    await api('/api/fs/write', { method: 'PUT', body: JSON.stringify({ path, content: tab.content }) });
    setTabs((prev) => prev.map((item) => item.path === path ? { ...item, savedContent: item.content, dirty: false } : item));
    if (controlPathRef.current && path === controlPathRef.current) void reloadWorkspaces();
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const own = '.tree-body, .side-list, .folder-view, .folder-table, .folder-icons, .menu, .xterm, .xterm-screen';
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
    setTermOpen(true);
    const id = activeTermRef.current;
    const alive = id && sessionsRef.current.some((item) => item.id === id && item.alive);
    if (id && alive) {
      sendTerm({ type: 'input', id, data: text });
      return;
    }
    const hint = activePathRef.current || selectedRef.current || treeRootRef.current;
    const ws = matchWorkspace(hint, workspacesRef.current);
    pendingRun.current = { setup: startupText(ws), text };
    sendTerm({ type: 'create', cwd: ws?.path || treeRootRef.current, name: ws?.name });
  };

  const runStartup = (ws: Workspace) => {
    const text = startupText(ws);
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
    sendTerm({ type: 'create', cwd: ws.path, name: ws.name });
  };

  const revealInTree = async (filePath: string) => {
    if (!filePath || filePath.startsWith('diff:')) return;
    const folders = workspacesRef.current;
    const currentRoot = treeRootRef.current;
    const currentWs = folders.find((item) => item.path === workspacePathRef.current) || null;
    const containing = matchWorkspace(filePath, folders);
    const isFolder = tabsRef.current.some((tab) => tab.path === filePath && tab.kind === 'folder')
      || Boolean(listingsRef.current[filePath]);
    let root = currentRoot;
    if (filePath === currentRoot || filePath.startsWith(currentRoot + '/') || currentRoot === '/') {
      root = currentRoot;
    } else if (currentWs && (filePath === currentWs.path || filePath.startsWith(currentWs.path + '/'))) {
      root = currentWs.path;
    } else if (containing) {
      root = containing.path;
      setWorkspacePath(containing.path);
      setSideTab('workspace');
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
    setExpanded(new Set(dirs));
    setSelected(filePath);
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

  function sendTerm(msg: TermClientMessage) {
    if (termWs.current?.readyState === WebSocket.OPEN) {
      termWs.current.send(JSON.stringify(msg));
    }
  }

  const openTerminalHere = (dir: string) => {
    setTermOpen(true);
    const ws = workspacesRef.current.find((item) => item.path === dir);
    sendTerm({ type: 'create', cwd: dir, name: ws?.name || basename(dir) });
  };

  const createDefaultTerminal = () => {
    openTerminalHere(workspacePathRef.current || treeRootRef.current);
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

  const currentPath = useMemo(() => activePath || selected, [activePath, selected]);
  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.path === workspacePath) || null,
    [workspacePath, workspaces],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" /> RemotePad</div>
        <div className="path">
          {activeWorkspace && <span className="ws-chip">{activeWorkspace.name}</span>}
          <span>{currentPath}</span>
        </div>
        <div className="spacer" />
        {machine && <div className="path">{machine.user}@{machine.hostname}</div>}
        <button
          className={termOpen ? 'primary' : 'ghost'}
          onClick={() => setTermOpen((v) => !v)}
        >
          {termOpen ? 'Hide terminal' : 'Show terminal'}
        </button>
      </header>
      <div className="shell">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={24} minSize={14}>
            <LeftSidebar
              roots={[treeRoot]}
              treeRoot={treeRoot}
              selected={selected}
              expanded={expanded}
              listings={listings}
              favorites={favorites}
              workspaces={workspaces}
              workspacePath={workspacePath}
              sideTab={sideTab}
              onSideTab={setSideTab}
              onSelect={(path) => setSelected(path)}
              onToggle={(path) => void toggleDir(path)}
              onOpen={(entry) => void openFile(entry)}
              onBrowse={(entry) => void openFolder(entry.path)}
              onCreate={(dir, kind, name) => void createNode(dir, kind, name)}
              onRename={(from, name) => void renameNode(from, name)}
              onDelete={(entry) => void deleteNode(entry)}
              onTerminal={openTerminalHere}
              onPin={(path) => void pinFolder(path)}
              onUnpin={(path) => void unpinFolder(path)}
              onAddWorkspace={(path) => void addWorkspace(path)}
              onRemoveWorkspace={(path) => void removeWorkspace(path)}
              onReveal={(path, asWorkspace) => {
                if (asWorkspace) {
                  setWorkspacePath(path);
                  setSideTab('workspace');
                }
                void revealDir(path);
              }}
              onClearWorkspace={() => void clearWorkspace()}
              onGoUp={() => void goUp()}
              onOpenControl={() => {
                if (!controlPath) return;
                void openFile({ name: basename(controlPath), path: controlPath, kind: 'file' });
              }}
              onRunStartup={runStartup}
            />
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel>
            <PanelGroup direction="vertical">
              <Panel>
                <PanelGroup direction="horizontal">
                  <Panel>
                    <EditorArea
                      tabs={tabs}
                      activePath={activePath}
                      onSelect={setActivePath}
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
                        } : tab));
                      }}
                      onSave={(path) => void save(path)}
                      onRunInTerminal={runInTerminal}
                      onRevealInTree={(path) => void revealInTree(path)}
                      onToggleView={(path, mode) => {
                        setTabs((prev) => prev.map((tab) => tab.path === path ? { ...tab, viewMode: mode } : tab));
                      }}
                      listings={listings}
                      favorites={favorites}
                      workspaces={workspaces}
                      onOpenFile={(entry) => void openFile(entry)}
                      onOpenFolder={navigateFolder}
                      onCreate={(dir, kind, name) => void createNode(dir, kind, name)}
                      onRename={(from, name) => void renameNode(from, name)}
                      onDelete={(entry) => void deleteNode(entry)}
                      onTerminal={openTerminalHere}
                      onPin={(path) => void pinFolder(path)}
                      onUnpin={(path) => void unpinFolder(path)}
                      onAddWorkspace={(path) => void addWorkspace(path)}
                      onRemoveWorkspace={(path) => void removeWorkspace(path)}
                      onLoadDir={loadDir}
                    />
                  </Panel>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel defaultSize={22} minSize={14} maxSize={40}>
                    <InfoPanel
                      path={currentPath}
                      machine={machine}
                      git={git}
                      sessions={sessions}
                      onOpenDiff={(path) => void openDiff(path)}
                      onSelectTerm={(id) => {
                        setTermOpen(true);
                        setActiveTerm(id);
                      }}
                    />
                  </Panel>
                </PanelGroup>
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
          </Panel>
        </PanelGroup>
      </div>
      {!termOpen && (
        <button className="term-show" onClick={() => setTermOpen(true)}>
          Show terminal · Ctrl+`
        </button>
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

function upsertSession(list: TermSessionInfo[], session: TermSessionInfo): TermSessionInfo[] {
  const i = list.findIndex((item) => item.id === session.id);
  if (i < 0) return [...list, session];
  const next = list.slice();
  next[i] = session;
  return next;
}

function matchWorkspace(path: string, folders: Workspace[]): Workspace | null {
  let best: Workspace | null = null;
  for (const item of folders) {
    if (path === item.path || path.startsWith(item.path + '/')) {
      if (!best || item.path.length > best.path.length) best = item;
    }
  }
  return best;
}

function startupText(ws: Workspace | null): string {
  if (!ws?.startup?.length) return '';
  return ws.startup.map((line) => line.endsWith('\n') ? line : `${line}\n`).join('');
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
  if (!filePath || filePath.startsWith('diff:')) return null;
  if (folder) {
    return {
      path: filePath,
      name: 'Explorer',
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
