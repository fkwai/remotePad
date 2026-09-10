import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Favorite, FsEntry, FsListResponse, FsReadResponse, GitDiffResponse, GitStatusResponse, MachineInfo, TermClientMessage, TermServerMessage, TermSessionInfo, WatchServerMessage } from '@remotepad/shared';
import { api } from './api';
import { basename, dirname, hasRenderedView, viewerKind } from './files';
import { FileTree } from './components/FileTree';
import { EditorArea, type OpenTab } from './components/EditorArea';
import { TerminalPanel } from './components/TerminalPanel';
import { InfoPanel } from './components/InfoPanel';

export function App() {
  const [roots, setRoots] = useState<string[]>(['/']);
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
  const pendingRun = useRef<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const loadDir = useCallback(async (dir: string) => {
    const res = await api<FsListResponse>(`/api/fs/list?path=${encodeURIComponent(dir)}`);
    setListings((prev) => ({ ...prev, [res.path]: res.entries }));
    watchPath(dir);
  }, []);

  function watchPath(dir: string) {
    if (watched.current.has(dir)) return;
    watched.current.add(dir);
    watchWs.current?.send(JSON.stringify({ type: 'watch', path: dir }));
  }

  useEffect(() => {
    api<{ roots: string[] }>('/api/fs/roots').then((res) => {
      setRoots(res.roots);
      const first = res.roots[0] || '/';
      setTreeRoot(first);
      setSelected(first);
      setExpanded(new Set([first]));
      void loadDir(first);
    }).catch((err) => showToast(String(err.message || err)));
    api<MachineInfo>('/api/machine').then(setMachine).catch(() => undefined);
    api<{ folders: Favorite[] }>('/api/favorites').then((res) => setFavorites(res.folders)).catch(() => undefined);
  }, [loadDir]);

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
          setSessions(msg.sessions);
          const ids = msg.sessions.map((item) => item.id);
          const remembered = pendingAttach.current.length ? pendingAttach.current : ids;
          for (const id of remembered) {
            if (ids.includes(id)) sendTerm({ type: 'attach', id });
          }
          setActiveTerm((cur) => cur || ids[0] || null);
        } else if (msg.type === 'created' || msg.type === 'renamed') {
          setSessions((prev) => upsertSession(prev, msg.session));
          if (msg.type === 'created') {
            setActiveTerm(msg.session.id);
            const pending = pendingRun.current;
            if (pending) {
              pendingRun.current = null;
              sendTerm({ type: 'input', id: msg.session.id, data: pending });
            }
          }
        } else if (msg.type === 'attached') {
          setSessions((prev) => upsertSession(prev, msg.session));
          if (msg.replay) termWrite.current(msg.session.id, msg.replay);
          setActiveTerm((cur) => cur || msg.session.id);
        } else if (msg.type === 'data') {
          termWrite.current(msg.id, msg.data);
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

  const resetTreeRoot = async () => {
    const first = roots[0] || '/';
    setTreeRoot(first);
    setSelected(first);
    setExpanded(new Set([first]));
    await loadDir(first);
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

  const openFile = async (entry: FsEntry) => {
    setSelected(entry.path);
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

  const save = async (path: string) => {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (!tab || tab.binary || tab.kind === 'diff') return;
    await api('/api/fs/write', { method: 'PUT', body: JSON.stringify({ path, content: tab.content }) });
    setTabs((prev) => prev.map((item) => item.path === path ? { ...item, savedContent: item.content, dirty: false } : item));
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

  const runInTerminal = (text: string) => {
    if (!text) return;
    setTermOpen(true);
    const id = activeTermRef.current;
    const alive = id && sessionsRef.current.some((item) => item.id === id && item.alive);
    if (id && alive) {
      sendTerm({ type: 'input', id, data: text });
      return;
    }
    pendingRun.current = text;
    sendTerm({ type: 'create', cwd: treeRootRef.current });
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
    sendTerm({ type: 'create', cwd: dir, name: basename(dir) });
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

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" /> RemotePad</div>
        <div className="path">{currentPath}</div>
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
          <Panel defaultSize={20} minSize={12}>
            <FileTree
              roots={[treeRoot]}
              treeRoot={treeRoot}
              selected={selected}
              expanded={expanded}
              listings={listings}
              favorites={favorites}
              onSelect={(path) => setSelected(path)}
              onToggle={(path) => void toggleDir(path)}
              onOpen={(entry) => void openFile(entry)}
              onCreate={(dir, kind, name) => void createNode(dir, kind, name)}
              onRename={(from, name) => void renameNode(from, name)}
              onDelete={(entry) => void deleteNode(entry)}
              onTerminal={openTerminalHere}
              onPin={(path) => void pinFolder(path)}
              onUnpin={(path) => void unpinFolder(path)}
              onFavorite={(path) => void revealDir(path)}
              onResetRoot={() => void resetTreeRoot()}
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
                      onToggleView={(path, mode) => {
                        setTabs((prev) => prev.map((tab) => tab.path === path ? { ...tab, viewMode: mode } : tab));
                      }}
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
                      onCreate={() => sendTerm({ type: 'create', cwd: selected && listings[selected] ? selected : selected ? dirname(selected) : treeRoot })}
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
