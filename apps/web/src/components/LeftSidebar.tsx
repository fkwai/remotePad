import { useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Favorite, FsEntry, Workspace } from '@remotepad/shared';
import { FileTree } from './FileTree';

export type SideTab = 'favorites' | 'workspace';

export function LeftSidebar({
  roots,
  treeRoot,
  selected,
  expanded,
  listings,
  favorites,
  workspaces,
  workspacePath,
  sideTab,
  onSideTab,
  onSelect,
  onToggle,
  onOpen,
  onBrowse,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onAddWorkspace,
  onRemoveWorkspace,
  onReveal,
  onClearWorkspace,
  onGoUp,
  onOpenControl,
  onRunStartup,
}: {
  roots: string[];
  treeRoot: string;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  workspaces: Workspace[];
  workspacePath: string | null;
  sideTab: SideTab;
  onSideTab: (tab: SideTab) => void;
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry) => void;
  onBrowse: (entry: FsEntry) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onReveal: (path: string, asWorkspace?: boolean) => void;
  onClearWorkspace: () => void;
  onGoUp: () => void;
  onOpenControl: () => void;
  onRunStartup: (ws: Workspace) => void;
}) {
  return (
    <PanelGroup direction="vertical" autoSaveId="remotepad-left" style={{ height: '100%' }}>
      <Panel defaultSize={32} minSize={14}>
        <SideLists
          treeRoot={treeRoot}
          favorites={favorites}
          workspaces={workspaces}
          workspacePath={workspacePath}
          sideTab={sideTab}
          onSideTab={onSideTab}
          onReveal={onReveal}
          onBrowse={onBrowse}
          onClearWorkspace={onClearWorkspace}
          onUnpin={onUnpin}
          onRemoveWorkspace={onRemoveWorkspace}
          onOpenControl={onOpenControl}
          onRunStartup={onRunStartup}
          onTerminal={onTerminal}
        />
      </Panel>
      <PanelResizeHandle className="resize-handle" />
      <Panel minSize={22}>
        <FileTree
          roots={roots}
          treeRoot={treeRoot}
          selected={selected}
          expanded={expanded}
          listings={listings}
          favorites={favorites}
          workspaces={workspaces}
          onSelect={onSelect}
          onToggle={onToggle}
          onOpen={onOpen}
          onBrowse={onBrowse}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          onTerminal={onTerminal}
          onPin={onPin}
          onUnpin={onUnpin}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onGoUp={onGoUp}
        />
      </Panel>
    </PanelGroup>
  );
}

function SideLists({
  treeRoot,
  favorites,
  workspaces,
  workspacePath,
  sideTab,
  onSideTab,
  onReveal,
  onBrowse,
  onClearWorkspace,
  onUnpin,
  onRemoveWorkspace,
  onOpenControl,
  onRunStartup,
  onTerminal,
}: {
  treeRoot: string;
  favorites: Favorite[];
  workspaces: Workspace[];
  workspacePath: string | null;
  sideTab: SideTab;
  onSideTab: (tab: SideTab) => void;
  onReveal: (path: string, asWorkspace?: boolean) => void;
  onBrowse: (entry: FsEntry) => void;
  onClearWorkspace: () => void;
  onUnpin: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onOpenControl: () => void;
  onRunStartup: (ws: Workspace) => void;
  onTerminal: (dir: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: SideTab; ws?: Workspace } | null>(null);
  const lastClick = useRef(0);
  const items = sideTab === 'favorites' ? favorites : workspaces;
  return (
    <div className="pane">
      <div className="side-tabs">
        <button className={sideTab === 'favorites' ? 'active fav' : ''} onClick={() => onSideTab('favorites')}>Favorites</button>
        <button className={sideTab === 'workspace' ? 'active ws' : ''} onClick={() => onSideTab('workspace')}>Workspace</button>
      </div>
      <div className="tree-body side-list">
        {sideTab === 'workspace' && (
          <>
            <button type="button" className="tree-node control-item" onClick={onOpenControl} title="Edit ~/.remotepad/workspaces.json">
              <span className="tree-icon">☰</span>
              <span className="tree-name">control file</span>
            </button>
            <button
              type="button"
              className={`tree-node dir fav-item ws-item ${workspacePath === null ? 'active' : ''}`}
              onClick={onClearWorkspace}
            >
              <span className="tree-icon">○</span>
              <span className="tree-name">none</span>
            </button>
          </>
        )}
        {items.length === 0 && (
          <div className="side-empty">
            {sideTab === 'favorites' ? 'Right-click a folder to pin a favorite.' : 'Right-click a folder to add a workspace.'}
          </div>
        )}
        {items.map((item) => (
          <button
            type="button"
            key={item.path}
            className={`tree-node dir fav-item ${sideTab === 'workspace' ? 'ws-item' : ''} ${
              sideTab === 'workspace' ? (workspacePath === item.path ? 'active' : '') : (treeRoot === item.path ? 'active' : '')
            }`}
            onClick={() => {
              const now = Date.now();
              const again = now - lastClick.current < 400;
              lastClick.current = now;
              if (again) return;
              onReveal(item.path, sideTab === 'workspace');
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
                ws: sideTab === 'workspace' ? item as Workspace : undefined,
              });
            }}
            title={item.path}
          >
            <span className={`tree-icon pin-mark ${sideTab === 'workspace' ? 'ws-mark' : ''}`}>{sideTab === 'favorites' ? '★' : '◆'}</span>
            <span className="tree-name">{item.name}</span>
            <span
              className="ghost pin"
              onClick={(e) => {
                e.stopPropagation();
                if (sideTab === 'favorites') onUnpin(item.path);
                else onRemoveWorkspace(item.path);
              }}
            >×</span>
          </button>
        ))}
      </div>
      {menu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenu(null)} />
          <div className="menu" style={{ left: menu.x, top: menu.y }}>
            {menu.kind === 'workspace' && menu.ws && (
              <button
                onClick={() => {
                  onRunStartup(menu.ws!);
                  setMenu(null);
                }}
              >Run startup</button>
            )}
            <button
              onClick={() => {
                onTerminal(menu.path);
                setMenu(null);
              }}
            >Open terminal here</button>
            <button
              className="danger"
              onClick={() => {
                if (menu.kind === 'favorites') onUnpin(menu.path);
                else onRemoveWorkspace(menu.path);
                setMenu(null);
              }}
            >{menu.kind === 'favorites' ? 'Unpin' : 'Remove'}</button>
          </div>
        </>
      )}
    </div>
  );
}
