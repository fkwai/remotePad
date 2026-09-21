import { useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Favorite, FsEntry, Repo } from '@remotepad/shared';
import { ActionMenu, type MenuItem } from './ContextMenu';
import { FileTree } from './FileTree';

export type SideTab = 'favorites' | 'repos';

export function LeftSidebar({
  roots,
  treeRoot,
  selected,
  revealTick,
  expanded,
  listings,
  favorites,
  repos,
  repoPath,
  sideTab,
  onSideTab,
  onSelect,
  onToggle,
  onOpen,
  onBrowse,
  onBrowseNew,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onAddRepo,
  onRemoveRepo,
  onReveal,
  onClearRepo,
  onGoUp,
  onOpenControl,
  onRunStartup,
  onReorderFavorites,
  onReorderRepos,
  pendingPaths,
}: {
  roots: string[];
  treeRoot: string;
  selected: string | null;
  revealTick: number;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  repos: Repo[];
  repoPath: string | null;
  sideTab: SideTab;
  onSideTab: (tab: SideTab) => void;
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry, temp?: boolean) => void;
  onBrowse: (entry: FsEntry) => void;
  onBrowseNew: (entry: FsEntry) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onReveal: (path: string, asRepo?: boolean) => void;
  onClearRepo: () => void;
  onGoUp: () => void;
  onOpenControl: () => void;
  onRunStartup: (repo: Repo) => void;
  onReorderFavorites: (paths: string[]) => void;
  onReorderRepos: (paths: string[]) => void;
  pendingPaths?: Set<string>;
}) {
  return (
    <PanelGroup direction="vertical" autoSaveId="remotepad-left" style={{ height: '100%' }}>
      <Panel defaultSize={32} minSize={14}>
        <SideLists
          treeRoot={treeRoot}
          favorites={favorites}
          repos={repos}
          repoPath={repoPath}
          sideTab={sideTab}
          onSideTab={onSideTab}
          onReveal={onReveal}
          onBrowse={onBrowse}
          onClearRepo={onClearRepo}
          onUnpin={onUnpin}
          onRemoveRepo={onRemoveRepo}
          onOpenControl={onOpenControl}
          onRunStartup={onRunStartup}
          onTerminal={onTerminal}
          onReorderFavorites={onReorderFavorites}
          onReorderRepos={onReorderRepos}
        />
      </Panel>
      <PanelResizeHandle className="resize-handle" />
      <Panel minSize={22}>
        <FileTree
          roots={roots}
          treeRoot={treeRoot}
          selected={selected}
          revealTick={revealTick}
          expanded={expanded}
          listings={listings}
          favorites={favorites}
          repos={repos}
          onSelect={onSelect}
          onToggle={onToggle}
          onOpen={onOpen}
          onBrowse={onBrowse}
          onBrowseNew={onBrowseNew}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          onTerminal={onTerminal}
          onPin={onPin}
          onUnpin={onUnpin}
          onAddRepo={onAddRepo}
          onRemoveRepo={onRemoveRepo}
          onGoUp={onGoUp}
          pendingPaths={pendingPaths}
        />
      </Panel>
    </PanelGroup>
  );
}

function SideLists({
  treeRoot,
  favorites,
  repos,
  repoPath,
  sideTab,
  onSideTab,
  onReveal,
  onBrowse,
  onClearRepo,
  onUnpin,
  onRemoveRepo,
  onOpenControl,
  onRunStartup,
  onTerminal,
  onReorderFavorites,
  onReorderRepos,
}: {
  treeRoot: string;
  favorites: Favorite[];
  repos: Repo[];
  repoPath: string | null;
  sideTab: SideTab;
  onSideTab: (tab: SideTab) => void;
  onReveal: (path: string, asRepo?: boolean) => void;
  onBrowse: (entry: FsEntry) => void;
  onClearRepo: () => void;
  onUnpin: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onOpenControl: () => void;
  onRunStartup: (repo: Repo) => void;
  onTerminal: (dir: string) => void;
  onReorderFavorites: (paths: string[]) => void;
  onReorderRepos: (paths: string[]) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: SideTab; repo?: Repo } | null>(null);
  const lastClick = useRef(0);
  const dragPath = useRef<string | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);
  const items = sideTab === 'favorites' ? favorites : repos;

  function move(from: string, to: string) {
    if (from === to) return;
    const paths = items.map((item) => item.path);
    const fromAt = paths.indexOf(from);
    const toAt = paths.indexOf(to);
    if (fromAt < 0 || toAt < 0) return;
    const next = paths.slice();
    next.splice(fromAt, 1);
    next.splice(toAt, 0, from);
    if (sideTab === 'favorites') onReorderFavorites(next);
    else onReorderRepos(next);
  }

  return (
    <div className="pane">
      <div className="side-tabs">
        <button className={sideTab === 'favorites' ? 'active fav' : ''} onClick={() => onSideTab('favorites')}>Favorites</button>
        <button className={sideTab === 'repos' ? 'active ws' : ''} onClick={() => onSideTab('repos')}>Repos</button>
      </div>
      <div className="tree-body side-list">
        {sideTab === 'repos' && (
          <>
            <button type="button" className="tree-node control-item" onClick={onOpenControl} title="Edit ~/.remotepad/workspaces.json">
              <span className="tree-icon">☰</span>
              <span className="tree-name">control file</span>
            </button>
            <button
              type="button"
              className={`tree-node dir fav-item ws-item ${repoPath === null ? 'active' : ''}`}
              onClick={onClearRepo}
            >
              <span className="tree-icon">○</span>
              <span className="tree-name">none</span>
            </button>
          </>
        )}
        {items.length === 0 && (
          <div className="side-empty">
            {sideTab === 'favorites' ? 'Right-click a folder to pin a favorite.' : 'Right-click a Git repo to add it.'}
          </div>
        )}
        {items.map((item) => {
          const repo = sideTab === 'repos' ? item as Repo : null;
          const active = sideTab === 'repos' ? repoPath === item.path : treeRoot === item.path;
          return (
            <button
              type="button"
              key={item.path}
              draggable
              className={`tree-node dir fav-item ${sideTab === 'repos' ? 'ws-item' : ''} ${active ? 'active' : ''} ${overPath === item.path ? 'drop-over' : ''}`}
              onClick={() => {
                const now = Date.now();
                const again = now - lastClick.current < 400;
                lastClick.current = now;
                if (again) return;
                onReveal(item.path, sideTab === 'repos');
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                onBrowse({ name: item.name, path: item.path, kind: 'dir' });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  path: item.path,
                  kind: sideTab,
                  repo: repo || undefined,
                });
              }}
              onDragStart={() => { dragPath.current = item.path; }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overPath !== item.path) setOverPath(item.path);
              }}
              onDragLeave={() => {
                if (overPath === item.path) setOverPath(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverPath(null);
                if (dragPath.current) move(dragPath.current, item.path);
                dragPath.current = null;
              }}
              onDragEnd={() => {
                dragPath.current = null;
                setOverPath(null);
              }}
              title={item.path}
            >
              <span className={`tree-icon pin-mark ${sideTab === 'repos' ? 'ws-mark' : ''}`}>{sideTab === 'favorites' ? '★' : '◆'}</span>
              <span className="tree-name">{item.name}</span>
              {repo && <span className="repo-head">{repoLine(repo)}</span>}
              <span
                className="ghost pin"
                onClick={(e) => {
                  e.stopPropagation();
                  if (sideTab === 'favorites') onUnpin(item.path);
                  else onRemoveRepo(item.path);
                }}
              >×</span>
            </button>
          );
        })}
      </div>
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={[
            { type: 'item', id: 'explore', label: 'Open in Explorer', hint: 'Dbl-click' },
            ...(menu.kind === 'repos' && menu.repo
              ? [{ type: 'item' as const, id: 'startup', label: 'Run startup' }]
              : []),
            { type: 'item', id: 'term', label: 'Open terminal here' },
            { type: 'sep' },
            {
              type: 'item',
              id: 'remove',
              label: menu.kind === 'favorites' ? 'Unpin favorite' : 'Remove from repos',
              danger: true,
            },
          ] satisfies MenuItem[]}
          onClose={() => setMenu(null)}
          onAction={(id) => {
            if (id === 'explore') onBrowse({ name: basename(menu.path), path: menu.path, kind: 'dir' });
            else if (id === 'startup' && menu.repo) onRunStartup(menu.repo);
            else if (id === 'term') onTerminal(menu.path);
            else if (id === 'remove') {
              if (menu.kind === 'favorites') onUnpin(menu.path);
              else onRemoveRepo(menu.path);
            }
          }}
        />
      )}
    </div>
  );
}

function basename(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() || filePath;
}

function repoLine(repo: Repo): string {
  if (!repo.branch && !repo.lastCommit) return 'not a git repo';
  const bits: string[] = [];
  bits.push(repo.branch || 'detached');
  if (repo.ahead) bits.push(`↑${repo.ahead}`);
  if (repo.behind) bits.push(`↓${repo.behind}`);
  if (repo.dirty) bits.push(`*${repo.dirty}`);
  if (repo.lastCommit) bits.push(`${repo.lastCommit.hash} ${repo.lastCommit.message}`);
  return bits.join(' ');
}
