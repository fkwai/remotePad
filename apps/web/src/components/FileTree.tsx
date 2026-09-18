import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Favorite, FsEntry, SearchHit, Workspace } from '@remotepad/shared';
import { api } from '../api';
import { fileMark } from '../files';
import { ContextMenu, type MenuState } from './ContextMenu';

export function FileTree({
  roots,
  treeRoot,
  selected,
  expanded,
  listings,
  favorites,
  workspaces,
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
  onGoUp,
}: {
  roots: string[];
  treeRoot: string;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  workspaces: Workspace[];
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
  onGoUp: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<{ dir: string; kind: 'file' | 'dir' | 'rename'; from?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirm, setConfirm] = useState<FsEntry | null>(null);
  const pinned = new Set(favorites.map((item) => item.path));
  const inWorkspace = new Set(workspaces.map((item) => item.path));

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const root = selected && listings[selected] ? selected : selected ? selected.slice(0, selected.lastIndexOf('/') || 1) : treeRoot;
    if (!root) return;
    const handle = window.setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(root)}`)
        .then((res) => setHits(res.hits))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, selected, treeRoot, listings]);

  function submitDraft() {
    if (!draft || !draftName.trim()) {
      setDraft(null);
      return;
    }
    if (draft.kind === 'rename' && draft.from) onRename(draft.from, draftName.trim());
    else if (draft.kind !== 'rename') onCreate(draft.dir, draft.kind, draftName.trim());
    setDraft(null);
    setDraftName('');
  }

  function onAction(action: string, entry: FsEntry) {
    const dir = entry.kind === 'dir' ? entry.path : parentOf(entry.path);
    if (action === 'pin') onPin(dir);
    else if (action === 'unpin') onUnpin(dir);
    else if (action === 'ws-add') onAddWorkspace(dir);
    else if (action === 'ws-remove') onRemoveWorkspace(dir);
    else if (action === 'new-file') {
      setDraft({ dir, kind: 'file' });
      setDraftName('');
    } else if (action === 'new-dir') {
      setDraft({ dir, kind: 'dir' });
      setDraftName('');
    } else if (action === 'rename') {
      setDraft({ dir, kind: 'rename', from: entry.path });
      setDraftName(entry.name);
    } else if (action === 'delete') {
      setConfirm(entry);
    } else if (action === 'term') {
      onTerminal(dir);
    }
  }

  return (
    <div className="pane">
      <div className="pane-head">
        Files
        <div className="actions">
          <button className="ghost" onClick={() => {
            const dir = selected ? dirOf(selected, listings) : roots[0];
            if (dir) { setDraft({ dir, kind: 'file' }); setDraftName(''); }
          }}>+</button>
        </div>
      </div>
      <div className="tree-search">
        <input
          type="search"
          placeholder="Search files"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tree-body">
        {hits ? hits.map((hit) => (
          <div
            key={hit.path}
            className={`search-hit ${selected === hit.path ? 'active' : ''}`}
            onClick={() => {
              onSelect(hit.path);
              onOpen({ name: hit.name, path: hit.path, kind: hit.kind });
            }}
          >
            {hit.name}
            <small>{hit.path}</small>
          </div>
        )) : (
          <>
            {treeRoot !== '/' && (
              <button type="button" className="tree-node up" onClick={onGoUp} title={parentOf(treeRoot)}>
                <span className="tree-twisty leaf" />
                <span className="tree-name">...</span>
              </button>
            )}
            {roots.map((root) => (
              <TreeNode
                key={root}
                entry={{ name: label(root), path: root, kind: 'dir' }}
                depth={0}
                selected={selected}
                expanded={expanded}
                listings={listings}
                pinned={pinned}
                inWorkspace={inWorkspace}
                onSelect={onSelect}
                onToggle={onToggle}
                onOpen={onOpen}
                onBrowse={onBrowse}
                onMenu={setMenu}
                onPin={onPin}
                onUnpin={onUnpin}
                onAddWorkspace={onAddWorkspace}
                onRemoveWorkspace={onRemoveWorkspace}
              />
            ))}
          </>
        )}
        {draft && (
          <div className="inline-input">
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              type="text"
              placeholder={draft.kind === 'dir' ? 'folder name' : 'file name'}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDraft();
                if (e.key === 'Escape') setDraft(null);
              }}
              onBlur={submitDraft}
            />
          </div>
        )}
        {confirm && (
          <div className="confirm-bar">
            <span>Delete {confirm.name}?</span>
            <button className="danger" onClick={() => { onDelete(confirm); setConfirm(null); }}>Delete</button>
            <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          pinned={pinned.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          inWorkspace={inWorkspace.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          onClose={() => setMenu(null)}
          onAction={onAction}
        />
      )}
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  selected,
  expanded,
  listings,
  pinned,
  inWorkspace,
  onSelect,
  onToggle,
  onOpen,
  onBrowse,
  onMenu,
  onPin,
  onUnpin,
  onAddWorkspace,
  onRemoveWorkspace,
}: {
  entry: FsEntry;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  pinned: Set<string>;
  inWorkspace: Set<string>;
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry) => void;
  onBrowse: (entry: FsEntry) => void;
  onMenu: (menu: MenuState) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
}) {
  const isDir = entry.kind === 'dir';
  const open = expanded.has(entry.path);
  const kids = listings[entry.path];
  const isPinned = pinned.has(entry.path);
  const isWorkspace = inWorkspace.has(entry.path);
  const mark = isDir ? null : fileMark(entry.path);
  const lastClick = useRef(0);
  const indent = depth * 16;
  return (
    <div className="tree-branch">
      <div
        className={`tree-node ${isDir ? 'dir' : ''} ${selected === entry.path ? 'active' : ''}`}
        onClick={() => {
          const now = Date.now();
          const again = now - lastClick.current < 400;
          lastClick.current = now;
          onSelect(entry.path, entry);
          if (again) return;
          if (isDir) onToggle(entry.path);
          else onOpen(entry);
        }}
        onDoubleClick={() => {
          if (isDir) onBrowse(entry);
          else onOpen(entry);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(entry.path, entry);
          onMenu({ x: e.clientX, y: e.clientY, entry });
        }}
      >
        <span className="tree-indent" style={{ width: indent }} />
        <span
          className={`tree-twisty ${isDir ? '' : 'leaf'} ${open ? 'open' : ''}`}
          onClick={(e) => {
            if (!isDir) return;
            e.stopPropagation();
            onSelect(entry.path, entry);
            onToggle(entry.path);
          }}
        >
          {isDir && (
            <svg className="tree-chevron" viewBox="0 0 16 16" aria-hidden>
              <path d="M6 3.5L11 8l-5 4.5" />
            </svg>
          )}
        </span>
        {mark && <span className={`file-mark ${mark.cls}`}>{mark.text}</span>}
        <span className="tree-name">{entry.name}</span>
        {isDir && (
          <>
            <button
              className={`ghost pin ${isWorkspace ? 'on ws' : ''}`}
              title={isWorkspace ? 'Remove from workspace' : 'Add to workspace'}
              onClick={(e) => {
                e.stopPropagation();
                if (isWorkspace) onRemoveWorkspace(entry.path);
                else onAddWorkspace(entry.path);
              }}
            >◆</button>
            <button
              className={`ghost pin ${isPinned ? 'on' : ''}`}
              title={isPinned ? 'Unpin favorite' : 'Pin favorite'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) onUnpin(entry.path);
                else onPin(entry.path);
              }}
            >★</button>
          </>
        )}
      </div>
      {isDir && open && kids && kids.length > 0 && (
        <div className="tree-children" style={{ ['--guide']: `${indent + 12}px` } as CSSProperties}>
          {kids.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              listings={listings}
              pinned={pinned}
              inWorkspace={inWorkspace}
              onSelect={onSelect}
              onToggle={onToggle}
              onOpen={onOpen}
              onBrowse={onBrowse}
              onMenu={onMenu}
              onPin={onPin}
              onUnpin={onUnpin}
              onAddWorkspace={onAddWorkspace}
              onRemoveWorkspace={onRemoveWorkspace}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function label(root: string): string {
  const parts = root.split('/').filter(Boolean);
  return parts[parts.length - 1] || '/';
}

function parentOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i <= 0 ? '/' : filePath.slice(0, i);
}

function dirOf(filePath: string, listings: Record<string, FsEntry[]>): string {
  if (listings[filePath] || filePath === '/') return filePath;
  return parentOf(filePath);
}
